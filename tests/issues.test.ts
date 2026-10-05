// Sign issues: one list for route patrol and Quick Catch, multi-select in list order, only
// listed values saved, and the lead's issue_type text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ISSUES, checkIssues, issueTypeText, issuesForAttempt, toggleIssue } from '../src/lib/issues.ts';

const DAMAGED = 'Damaged / Impact damage';
const PARTIAL = 'Partially lit';
const FADED = 'Faded / Sun bleached';

test('select two, then deselect one', () => {
  let sel = toggleIssue([], PARTIAL);
  sel = toggleIssue(sel, DAMAGED);
  assert.deepEqual(sel, [DAMAGED, PARTIAL]);
  sel = toggleIssue(sel, PARTIAL);
  assert.deepEqual(sel, [DAMAGED]);
  assert.deepEqual(toggleIssue(sel, DAMAGED), []);
});

test('selection is kept in list order whatever the tap order, and is never mutated', () => {
  const taps = [FADED, PARTIAL, DAMAGED];
  const before: string[] = [];
  const sel = taps.reduce<string[]>((s, i) => toggleIssue(s, i), before);
  assert.deepEqual(sel, [DAMAGED, PARTIAL, FADED]);
  assert.deepEqual(before, []);
});

test('the lead issue_type is the issues joined with ", " in list order; none gives null', () => {
  const sel = [FADED, DAMAGED, PARTIAL].reduce<string[]>((s, i) => toggleIssue(s, i), []);
  assert.equal(issueTypeText(sel), 'Damaged / Impact damage, Partially lit, Faded / Sun bleached');
  assert.equal(issueTypeText([]), null);
});

test('"None" is exclusive: ticking it clears the others, ticking another clears it', () => {
  const list = ['None', ...ISSUES];
  let sel = toggleIssue(toggleIssue([], DAMAGED, list), PARTIAL, list);
  sel = toggleIssue(sel, 'None', list);
  assert.deepEqual(sel, ['None']);
  sel = toggleIssue(sel, FADED, list);
  assert.deepEqual(sel, [FADED]);
});

test('the shared list has no "None" choice today (leaving it blank means no issues)', () => {
  assert.deepEqual(ISSUES.filter((i) => /^(none|no issues?)$/i.test(i)), []);
});

test('only values from the fixed list are accepted', () => {
  assert.deepEqual(checkIssues([PARTIAL, DAMAGED]), { ok: true, issues: [DAMAGED, PARTIAL] });
  assert.deepEqual(checkIssues([]), { ok: true, issues: [] });
  for (const bad of [['Graffiti'], [DAMAGED, 'damaged / impact damage'], [`${DAMAGED} `], [DAMAGED, DAMAGED], [null], [42], ['<b>x</b>']]) {
    assert.equal(checkIssues(bad).ok, false, JSON.stringify(bad));
  }
  // A tap on something that isn't listed can't add it.
  assert.deepEqual(toggleIssue([DAMAGED], 'Graffiti'), [DAMAGED]);
});

test('Quick Catch retry keeps the issues saved with the inspection record', () => {
  const selection = [DAMAGED, PARTIAL];
  const first = issuesForAttempt(null, selection);
  assert.deepEqual(first, { ok: true, issues: [DAMAGED, PARTIAL] });
  assert.ok(first.ok);
  // The record is saved, the lead fails; the retry uses what the record has, not a fresh read.
  const retry = issuesForAttempt(first.issues, [DAMAGED]);
  assert.deepEqual(retry, { ok: true, issues: [DAMAGED, PARTIAL] });
  assert.deepEqual(selection, [DAMAGED, PARTIAL]);
});

test('both issue screens use the shared list, and the Quick Catch error path keeps the selection', () => {
  const page = (name: string) => readFileSync(new URL(`../src/pages/${name}`, import.meta.url), 'utf8');
  for (const name of ['IssuesPage.tsx', 'QuickCatchPage.tsx']) {
    const src = page(name);
    assert.match(src, /import \{[^}]*\bISSUES\b[^}]*\} from '\.\.\/lib\/issues'/, name);
    assert.doesNotMatch(src, /'Damaged \/ Impact damage'/, `${name} has its own issue list`);
  }
  const qc = page('QuickCatchPage.tsx');
  const catchBlock = qc.slice(qc.indexOf('} catch (e) {'), qc.indexOf('const handleSubmit'));
  assert.ok(catchBlock.length > 0);
  assert.doesNotMatch(catchBlock, /setIssues/);
});
