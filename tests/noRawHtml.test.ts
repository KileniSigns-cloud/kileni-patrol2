// Guard: route text (and everything else) is rendered as React text. Nothing in src may inject
// raw HTML; if a feature ever needs it, it needs a sanitiser and a review first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW_HTML = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('no raw HTML injection anywhere in src', () => {
  const files = sourceFiles(fileURLToPath(new URL('../src', import.meta.url)));
  assert.ok(files.length > 30, `found ${files.length} files`);
  const hits = files.flatMap((f) =>
    readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (RAW_HTML.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])));
  assert.deepEqual(hits, []);
});
