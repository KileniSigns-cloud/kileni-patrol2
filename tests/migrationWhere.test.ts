// Static check: every UPDATE and DELETE in migrations 014 and 015 (and their rollbacks) has a
// WHERE. Supabase runs pg-safeupdate for API roles, which rejects an UPDATE or DELETE without one
// ("UPDATE requires a WHERE clause"); PGlite does not, so the RPC tests can't catch it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { nonAscii, readMigration } from './helpers/zoneDb.ts';

const FILES = readdirSync(new URL('../migrations/', import.meta.url))
  .filter((f) => /^01[45].*\.sql$/.test(f))
  .sort();

/** SQL with comments blanked and string literals emptied, so neither can fake or hide a keyword. */
function stripSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      out += ' ';
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") { i++; break; }
        else i++;
      }
      out += "''";
    } else {
      out += sql[i++];
    }
  }
  return out;
}

/** Each UPDATE/DELETE statement, with whether it has a WHERE of its own (not one inside a subquery). */
function writeStatements(sql: string): { text: string; hasWhere: boolean }[] {
  const code = stripSql(sql);
  const found: { text: string; hasWhere: boolean }[] = [];
  const re = /\bUPDATE\s+[\w.]+(?:\s+(?!SET\b)\w+)?\s+SET\b|\bDELETE\s+FROM\b/gi;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 0;
    let hasWhere = false;
    let j = m.index;
    for (; j < code.length && !(depth <= 0 && code[j] === ';'); j++) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') { if (--depth < 0) break; }
      else if (depth === 0 && /^WHERE\b/i.test(code.slice(j, j + 6)) && /\W/.test(code[j - 1])) hasWhere = true;
    }
    found.push({ text: code.slice(m.index, j).replace(/\s+/g, ' ').slice(0, 80), hasWhere });
  }
  return found;
}

test('the checker finds an UPDATE without WHERE and ignores comments, strings and subqueries', () => {
  const bad = writeStatements(`UPDATE pg_temp.t i SET a = (SELECT 1 FROM x WHERE x.id = i.id), b = 2;`);
  assert.deepEqual(bad.map((s) => s.hasWhere), [false]);
  assert.deepEqual(writeStatements(`DELETE FROM t;`).map((s) => s.hasWhere), [false]);
  assert.deepEqual(writeStatements(`UPDATE t SET a = 1 WHERE id = 2; DELETE FROM t WHERE false;`).map((s) => s.hasWhere), [true, true]);
  assert.deepEqual(writeStatements(`-- UPDATE t SET a = 1;\nSELECT 'UPDATE t SET a = 1;' FROM t FOR UPDATE;`), []);
});

test('every UPDATE and DELETE in migrations 014 and 015 has a WHERE', () => {
  assert.ok(FILES.includes('014_zones.sql') && FILES.includes('015_zone_import.sql'), FILES.join(', '));
  let total = 0;
  for (const f of FILES) {
    const stmts = writeStatements(readMigration(f));
    total += stmts.length;
    assert.deepEqual(stmts.filter((s) => !s.hasWhere).map((s) => s.text), [], f);
  }
  assert.ok(total >= 4, `expected the 015 UPDATE statements to be found, got ${total}`);
});

test('migrations 014 and 015 stay ASCII-only', () => {
  for (const f of FILES) assert.deepEqual(nonAscii(readMigration(f)), [], f);
});
