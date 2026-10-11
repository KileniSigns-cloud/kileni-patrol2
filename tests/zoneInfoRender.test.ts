// ZoneInfo rendered to HTML: zone text is always plain text, the zone map and per-corner links
// are safe Google Maps links, the preview note is there, labels use --tx (not --mut), empty
// sections vanish. Node can't load .tsx, so the component is bundled with esbuild first and
// rendered with react-dom/server.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

interface Rendered {
  render: (zone: Record<string, unknown>, props?: Record<string, unknown>) => string;
  note: string;
}
let m: Rendered;

before(async () => {
  const out = await build({
    stdin: {
      contents: `
        import { renderToStaticMarkup } from 'react-dom/server';
        import { createElement } from 'react';
        import ZoneInfo, { ZONE_MAP_NOTE } from './src/components/zone/ZoneInfo';
        export const render = (zone, props = {}) => renderToStaticMarkup(createElement(ZoneInfo, { zone, ...props }));
        export const note = ZONE_MAP_NOTE;
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', write: false, logLevel: 'error',
  });
  const file = join(mkdtempSync(join(tmpdir(), 'zone-info-')), 'bundle.cjs');
  writeFileSync(file, out.outputFiles[0].text);
  m = createRequire(import.meta.url)(file) as Rendered;
});

const CON01 = {
  code: 'CON-01', name: 'Concord, Dufferin to Keele', area_type: 'Mixed', focus: null, anchors: null, est_minutes: null,
  corners: [
    { label: 'Dufferin & Steeles, Concord ON' }, { label: 'Keele & Steeles, Concord ON' },
    { label: 'Keele & Hwy 7, Concord ON' }, { label: 'Dufferin & Centre Street, Concord ON' },
  ],
};
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((x) => x[1].replace(/&amp;/g, '&'));

test('CON-01: one Open zone map (closed loop) and 4 per-corner Open in Maps, all new-tab noopener noreferrer', () => {
  const html = m.render(CON01, { large: true });
  const links = hrefs(html);
  assert.equal(links.length, 5);
  assert.equal(links[0],
    'https://www.google.com/maps/dir/?api=1&origin=Dufferin%20%26%20Steeles%2C%20Concord%20ON&destination=Dufferin%20%26%20Steeles%2C%20Concord%20ON'
    + '&waypoints=Keele%20%26%20Steeles%2C%20Concord%20ON%7CKeele%20%26%20Hwy%207%2C%20Concord%20ON%7CDufferin%20%26%20Centre%20Street%2C%20Concord%20ON&travelmode=driving');
  assert.deepEqual(links.slice(1).map((h) => new URL(h).searchParams.get('query')), CON01.corners.map((c) => c.label));
  assert.ok(links.every((h) => h.startsWith('https://www.google.com/maps/')));
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 5);
  assert.ok(html.includes('Open zone map'));
  assert.equal((html.match(/Open in Maps/g) ?? []).length, 4);
  assert.ok(html.includes('Loop: 1 → 2 → 3 → 4 → 1'));
});

test('the preview-only note sits with Open zone map', () => {
  assert.equal(m.note, "Preview only. Don't press Start in Maps. Drive the edges and turn into side streets.");
  const html = m.render(CON01);
  const at = html.indexOf('Open zone map');
  assert.ok(at > 0 && html.indexOf("Preview only. Don&#x27;t press Start in Maps. Drive the edges and turn into side streets.") > at);
});

test('contrast: no --mut text anywhere in the zone info', () => {
  const html = m.render({ ...CON01, focus: 'Pylons', anchors: [{ name: 'Plaza', address: '1 Main St' }], est_minutes: 90 }, { large: true });
  assert.ok(!html.includes('text-mut'), html);
  assert.ok(html.includes('text-tx'));
});

test('estimate only when filled; anchors and focus shown; corners without GPS say so', () => {
  assert.ok(!m.render(CON01).includes('About'));
  const html = m.render({ ...CON01, est_minutes: 90, focus: 'Faded pylons', anchors: [{ name: 'Plaza', address: '1 Main St' }, { name: 'Depot' }] });
  assert.ok(html.includes('About 90 min'));
  assert.ok(html.includes('Faded pylons'));
  assert.ok(html.includes('Plaza') && html.includes('1 Main St') && html.includes('Depot'));
  assert.equal((html.match(/No GPS: Maps searches the name/g) ?? []).length, 4);
  const gps = m.render({ ...CON01, corners: [{ label: 'A', lat: 43.7, lng: -79.4 }, ...CON01.corners.slice(1)] });
  assert.equal((gps.match(/No GPS/g) ?? []).length, 3);
  assert.ok(hrefs(gps)[1].endsWith('query=43.7%2C-79.4'));
});

test('"&", "<b>", <script> and javascript: render as text in every field and stay inside the links', () => {
  const html = m.render({
    code: 'X&<b>1</b>', name: 'Tim & Co <b>bold</b>', area_type: '<img src=x onerror=alert(1)>', focus: 'Signs & <script>alert(1)</script>',
    est_minutes: null, anchors: [{ name: 'Plaza & <b>Mall</b>', address: '<i>1</i>' }],
    corners: [{ label: 'javascript:alert(1)//' }, { label: '<b>B</b>' }, { label: 'a"onmouseover="x' }, { label: 'D' }],
  });
  assert.ok(!/<b>|<\/b>|<script|<img|<i>/.test(html), html);
  for (const s of ['X&amp;&lt;b&gt;1&lt;/b&gt;', 'Tim &amp; Co &lt;b&gt;bold&lt;/b&gt;', '&lt;img src=x onerror=alert(1)&gt;',
    'Signs &amp; &lt;script&gt;alert(1)&lt;/script&gt;', 'Plaza &amp; &lt;b&gt;Mall&lt;/b&gt;']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(hrefs(html).every((h) => h.startsWith('https://www.google.com/maps/')));
  assert.ok(!html.includes('onmouseover="'));
});

test('nothing to show, nothing rendered: no corners means no map link and no empty boxes', () => {
  const html = m.render({ code: 'OLD-01', name: 'Old row', area_type: null, focus: null, anchors: null, est_minutes: null, corners: null });
  assert.ok(!html.includes('<a '));
  assert.ok(!/Corners|Anchors|Focus/.test(html));
});
