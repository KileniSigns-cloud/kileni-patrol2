// RouteInfo rendered to HTML: route text is always plain text, empty sections vanish, Directions
// stay collapsed, the Maps link is safe. Node can't load .tsx, so the component is bundled with
// esbuild first and rendered with react-dom/server.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

interface Rendered {
  render: (route: Record<string, unknown>, props?: Record<string, unknown>) => string;
  renderSteps: (steps: string[]) => string;
}
let m: Rendered;

before(async () => {
  const out = await build({
    stdin: {
      contents: `
        import { renderToStaticMarkup } from 'react-dom/server';
        import { createElement } from 'react';
        import RouteInfo, { StepList } from './src/components/route/RouteInfo';
        export const render = (route, props = {}) => renderToStaticMarkup(createElement(RouteInfo, { route, ...props }));
        export const renderSteps = (steps) => renderToStaticMarkup(createElement(StepList, { steps }));
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', write: false, logLevel: 'error',
  });
  const file = join(mkdtempSync(join(tmpdir(), 'route-info-')), 'bundle.cjs');
  writeFileSync(file, out.outputFiles[0].text);
  m = createRequire(import.meta.url)(file) as Rendered;
});

const base = { code: 'GRID MIS-01', name: 'Lakeview', description: null, area_type: null, start_point: null, focus: null, hotspots: null, steps: null };

test('"&" and "<b>" (and <script>, <img onerror>) render as text in every field', () => {
  const html = m.render({
    code: 'X&<b>1</b>', name: 'Tim & Co <b>bold</b>', description: 'Desc & <b>x</b>', area_type: '<img src=x onerror=alert(1)>',
    start_point: 'Head West on A & <b>B</b> at C Rd', focus: 'Signs & <script>alert(1)</script>',
    hotspots: ['Plaza & <b>Mall</b>'], steps: [{ id: 1, label: 'Turn <b>LEFT</b>' }],
  }, { showDescription: true });
  assert.ok(!/<b>|<\/b>|<script|<img/.test(html), html);
  for (const s of ['X&amp;&lt;b&gt;1&lt;/b&gt;', 'Tim &amp; Co &lt;b&gt;bold&lt;/b&gt;', 'Desc &amp; &lt;b&gt;x&lt;/b&gt;',
    '&lt;img src=x onerror=alert(1)&gt;', 'Signs &amp; &lt;script&gt;alert(1)&lt;/script&gt;', 'Plaza &amp; &lt;b&gt;Mall&lt;/b&gt;']) {
    assert.ok(html.includes(s), s);
  }
  const steps = m.renderSteps(['Turn <b>LEFT</b> & go (note <i>x</i> & y).']);
  assert.ok(!/<b>|<i>/.test(steps), steps);
  assert.ok(steps.includes('Turn &lt;b&gt;LEFT&lt;/b&gt; &amp; go</span>'));
  assert.ok(steps.includes('note &lt;i&gt;x&lt;/i&gt; &amp; y</span>'));
});

test('Open in Maps: Google Maps search URL, encoded, new tab with noopener noreferrer', () => {
  const html = m.render({ ...base, start_point: 'Head West on Lakeshore Rd E at Dixie Rd (City of Toronto / Peel Boundary).' });
  assert.ok(html.includes('href="https://www.google.com/maps/search/?api=1&amp;query=Lakeshore%20Rd%20E%20%26%20Dixie%20Rd"'), html);
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(!m.render(base).includes('<a '), 'no start point, no link');
});

test('Directions are collapsed to "N steps" until tapped', () => {
  const html = m.render({ ...base, steps: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] });
  assert.ok(html.includes('aria-expanded="false"'));
  assert.match(html, /Directions<\/span>.*2.*steps/);
  assert.ok(!html.includes('<ol'));
});

test('nothing to show, nothing rendered: no empty boxes', () => {
  for (const steps of [null, [], [{ id: 1, label: '  ' }], 'text', [{ id: 1 }]]) {
    assert.ok(!/Directions|<ol/.test(m.render({ ...base, steps })), JSON.stringify(steps));
  }
  assert.equal(m.render({ ...base, code: null, name: 'Downtown Route' }), '<section aria-label="Route info"><h2 class="mt-1.5 mb-1 text-xl font-extrabold">Downtown Route</h2></section>');
});

test('description shows on the preview only (showDescription), and the title can be the page h1', () => {
  const route = { ...base, description: 'About this loop' };
  assert.ok(!m.render(route).includes('About this loop'));
  const preview = m.render(route, { showDescription: true, titleAs: 'h1' });
  assert.ok(preview.includes('About this loop'));
  assert.ok(preview.includes('<h1>Lakeview</h1>'));
});

test('steps: numbered list, trailing (note) on a lighter second line', () => {
  const html = m.renderSteps(['Turn LEFT (South) onto Haig Blvd (Drive park access perimeter).', 'Turn LEFT (West) onto Lakeshore Rd E.']);
  assert.equal((html.match(/<li /g) ?? []).length, 2);
  assert.ok(html.includes('<span class="block">Turn LEFT (South) onto Haig Blvd</span><span class="block text-mut text-[0.9em] mt-0.5">Drive park access perimeter</span>'));
  assert.ok(html.includes('<span class="block">Turn LEFT (West) onto Lakeshore Rd E.</span></span>'));
});

test('the 15 live v1 routes render one item per step, without their stored numbers', async () => {
  const { stepLabels } = await import('../src/lib/routeInfo.ts');
  const v1 = JSON.parse(readFileSync(new URL('./fixtures/v1-steps.json', import.meta.url), 'utf8')) as {
    routes: Record<string, { id: number; label: string }[]>;
  };
  for (const [code, steps] of Object.entries(v1.routes)) {
    const html = m.renderSteps(stepLabels(steps));
    assert.equal((html.match(/<li /g) ?? []).length, steps.length, code);
    assert.ok(!/<span class="block">\d+[.)]/.test(html), code);
    assert.ok(!html.includes('text-mut text-[0.9em]'), `${code}: no note lines`);
  }
});
