// RouteInfo helpers: step labels (v1 and imported), trailing notes, badge text, Maps link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hotspotList, mapsQuery, mapsUrl, splitStepNote, stepLabels, stepsBadge } from '../src/lib/routeInfo.ts';

const v1 = JSON.parse(readFileSync(new URL('./fixtures/v1-steps.json', import.meta.url), 'utf8')) as {
  routes: Record<string, { id: number; label: string }[]>;
};

test('stepLabels reads v1/import objects and plain strings, strips numbers, ignores anything else', () => {
  assert.deepEqual(stepLabels([{ id: 1, label: '1.\tWest on Rexdale Blvd' }, { id: 2, label: '2) North on Hwy 27' }, '3. East on Finch']),
    ['West on Rexdale Blvd', 'North on Hwy 27', 'East on Finch']);
  for (const nothing of [null, undefined, 'text', {}, [], [{ id: 1 }], [{ id: 1, label: '   ' }], [42]]) {
    assert.deepEqual(stepLabels(nothing), [], JSON.stringify(nothing));
  }
});

test('every live v1 route (15 routes) renders its steps without numbers or false notes', () => {
  const routes = Object.entries(v1.routes);
  assert.equal(routes.length, 15);
  for (const [code, steps] of routes) {
    const labels = stepLabels(steps);
    assert.equal(labels.length, steps.length, code);
    for (const l of labels) {
      assert.ok(!/^\d+\s*[.)]/.test(l) && !l.includes('\t'), `${code}: ${l}`);
      assert.equal(splitStepNote(l).note, null, `${code}: ${l}`);
    }
  }
  assert.deepEqual(stepLabels(v1.routes['GRID REX-01']), [
    'West on Rexdale Blvd to Hwy 427', 'North on Hwy 27 to Finch Ave W',
    'East on Finch Ave W to Martin Grove Rd', 'South on Martin Grove Rd back to Rexdale Blvd',
  ]);
});

test('a trailing (note) becomes a second line; inline and compass-only brackets stay', () => {
  assert.deepEqual(splitStepNote('Turn LEFT (South) onto Haig Blvd (Drive park access perimeter).'),
    { text: 'Turn LEFT (South) onto Haig Blvd', note: 'Drive park access perimeter' });
  assert.deepEqual(splitStepNote('END / LOOP EXIT: South on Winston Churchill Blvd to Lakeshore Rd W (Town of Oakville Boundary).'),
    { text: 'END / LOOP EXIT: South on Winston Churchill Blvd to Lakeshore Rd W', note: 'Town of Oakville Boundary' });
  assert.deepEqual(splitStepNote('Turn LEFT (West) onto Lakeshore Rd E.'), { text: 'Turn LEFT (West) onto Lakeshore Rd E.', note: null });
  assert.deepEqual(splitStepNote('Turn LEFT (South)'), { text: 'Turn LEFT (South)', note: null });
  assert.deepEqual(splitStepNote('Merge (Northbound).'), { text: 'Merge (Northbound).', note: null });
  assert.deepEqual(splitStepNote('(only a note)'), { text: '(only a note)', note: null });
});

test('badge: N steps, 1 step, No directions', () => {
  assert.equal(stepsBadge(v1.routes['AUR-01']), '3 steps');
  assert.equal(stepsBadge([{ id: 1, label: 'x' }]), '1 step');
  assert.equal(stepsBadge(null), 'No directions');
  assert.equal(stepsBadge([]), 'No directions');
});

test('hotspotList keeps non-blank strings only', () => {
  assert.deepEqual(hotspotList(['A', ' ', 3, ' B ']), ['A', 'B']);
  assert.deepEqual(hotspotList('A, B'), []);
});

test('Maps query: "X at Y" becomes "X & Y" without the leading direction or trailing note; else raw', () => {
  assert.equal(mapsQuery('Head West on Lakeshore Rd E at Dixie Rd (City of Toronto / Peel Boundary).'), 'Lakeshore Rd E & Dixie Rd');
  assert.equal(mapsQuery('Head South on Southdown Rd at Truscott Dr.'), 'Southdown Rd & Truscott Dr');
  assert.equal(mapsQuery('Industrial Pkwy S at Vandorf Sideroad'), 'Industrial Pkwy S & Vandorf Sideroad');
  // No "at": the start point exactly as typed (trimmed), brackets and all.
  assert.equal(mapsQuery('Hwy 27 & Rexdale Blvd (Heading West).'), 'Hwy 27 & Rexdale Blvd (Heading West).');
  assert.equal(mapsQuery('  Bloor & Bay '), 'Bloor & Bay');
  assert.equal(mapsQuery('Head West on Lakeshore Rd E.'), 'Head West on Lakeshore Rd E.');
});

test('Maps URL: fixed https origin, encoded query, no region added, blank gives none', () => {
  assert.equal(mapsUrl('Head West on Lakeshore Rd E at Dixie Rd.'),
    'https://www.google.com/maps/search/?api=1&query=Lakeshore%20Rd%20E%20%26%20Dixie%20Rd');
  assert.equal(mapsUrl('javascript:alert(document.cookie)//'),
    'https://www.google.com/maps/search/?api=1&query=javascript%3Aalert(document.cookie)%2F%2F');
  assert.equal(mapsUrl('A <b>B</b> at C & D'), 'https://www.google.com/maps/search/?api=1&query=A%20%3Cb%3EB%3C%2Fb%3E%20%26%20C%20%26%20D');
  assert.equal(mapsUrl(null), null);
  assert.equal(mapsUrl('   '), null);
});
