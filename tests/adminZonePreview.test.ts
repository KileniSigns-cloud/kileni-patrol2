// Admin preview (Manage zones > Preview): Zone info content, no Start patrol. The page shell
// (Screen: app header, timer, bottom nav) needs the live app's providers, so it is replaced by a
// stub that renders the children and, if one is passed, the footer: a footer would be where a
// Start patrol button lives. The patroller preview page is checked to still have Start patrol.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let render: (zone: Record<string, unknown>) => string;
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

before(async () => {
  const out = await build({
    stdin: {
      contents: `
        import { renderToStaticMarkup } from 'react-dom/server';
        import { createElement } from 'react';
        import { MemoryRouter } from 'react-router-dom';
        import AdminZonePreview from './src/components/zone/AdminZonePreview';
        export const render = (zone) => renderToStaticMarkup(
          createElement(MemoryRouter, null, createElement(AdminZonePreview, { zone, routeId: 'z-1' })));
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    plugins: [{
      name: 'stub-screen',
      setup(b) {
        b.onResolve({ filter: /layout\/Screen$/ }, () => ({ path: 'screen-stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `export default ({ children, footer }) => (
            <div data-screen="">{children}{footer ? <footer data-footer="">{footer}</footer> : null}</div>);`,
          loader: 'tsx',
          resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        }));
      },
    }],
    bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', write: false, logLevel: 'error',
  });
  const file = join(mkdtempSync(join(tmpdir(), 'admin-zone-preview-')), 'bundle.cjs');
  writeFileSync(file, out.outputFiles[0].text);
  ({ render } = createRequire(import.meta.url)(file) as { render: typeof render });
});

const CON01 = {
  code: 'CON-01', name: 'Concord, Dufferin to Keele', area_type: 'Mixed', focus: null, anchors: null, est_minutes: null,
  corners: [
    { label: 'Dufferin & Steeles, Concord ON' }, { label: 'Keele & Steeles, Concord ON' },
    { label: 'Keele & Hwy 7, Concord ON' }, { label: 'Dufferin & Centre Street, Concord ON' },
  ],
};

test('admin preview shows the Zone info content: Open zone map, the note, 4 corners with Open in Maps', () => {
  const html = render(CON01);
  assert.ok(html.includes('Zone preview'));
  assert.ok(html.includes('Concord, Dufferin to Keele'));
  assert.ok(html.includes('Open zone map'));
  assert.ok(html.includes('Preview only. Don&#x27;t press Start in Maps.'));
  assert.equal((html.match(/Open in Maps/g) ?? []).length, 4);
  assert.ok(html.includes('>Edit</button>'));
});

test('admin preview has no Start patrol and no footer action bar', () => {
  const html = render(CON01);
  assert.ok(!/Start patrol|Back to patrol/.test(html), html);
  assert.ok(!html.includes('data-footer'), 'no footer passed to Screen');
  assert.ok(!html.includes('<button class="btn btn-pri btn-xl'), 'no hero action button');
});

test('wiring: Manage zones Preview opens the admin-only preview; the Zones tab keeps Start patrol', () => {
  assert.match(src('pages/AdminRoutesPage.tsx'), /navigate\(`\/admin\/routes\/\$\{r\.id\}\/preview`\)\}><MapIcon aria-hidden \/>Preview/);
  assert.ok(!src('pages/AdminRoutesPage.tsx').includes('navigate(`/route/${r.id}`)'));
  assert.match(src('App.tsx'), /path="\/admin\/routes\/:routeId\/preview" element=\{<ProtectedRoute adminOnly><AdminZonePreviewPage \/><\/ProtectedRoute>\}/);
  const admin = src('pages/AdminZonePreviewPage.tsx') + src('components/zone/AdminZonePreview.tsx');
  assert.ok(!admin.includes('/>Start patrol'), 'no Start patrol button');
  assert.ok(!/footer=|patrol_sessions|startSession/.test(admin), 'no footer, no session insert');
  // Patrollers: RoutePreviewPage (/route/:id from the Zones tab) is unchanged and still starts patrols.
  const patroller = src('pages/RoutePreviewPage.tsx');
  assert.ok(patroller.includes('<Play aria-hidden />Start patrol'));
  assert.ok(patroller.includes(".from('patrol_sessions')"));
  assert.match(src('pages/RoutesPage.tsx'), /navigate\(`\/route\/\$\{r\.id\}`\)/);
});
