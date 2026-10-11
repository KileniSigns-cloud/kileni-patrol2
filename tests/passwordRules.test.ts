// The shared password rule: at least 8 characters (matches BUILT's invite sign-up), and the
// confirmation must match. Length is checked first, so a short password reports length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordError } from '../src/lib/passwordRules.ts';

const TOO_SHORT = 'Password must be at least 8 characters.';
const MISMATCH = 'Passwords do not match.';

test('minimum length is 8, and the hint says so', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(PASSWORD_HINT, 'At least 8 characters.');
});

test('length boundary: 7 fails, 8 and 9 pass', () => {
  assert.equal(passwordError('', ''), TOO_SHORT);
  assert.equal(passwordError('abcdefg', 'abcdefg'), TOO_SHORT);
  assert.equal(passwordError('abcdefgh', 'abcdefgh'), null);
  assert.equal(passwordError('abcdefghi', 'abcdefghi'), null);
});

test('spaces count as characters and are not trimmed', () => {
  assert.equal(passwordError('       a', '       a'), null);
  assert.equal(passwordError('abcdefgh ', 'abcdefgh'), MISMATCH);
});

test('confirmation must match exactly, including case', () => {
  assert.equal(passwordError('Sunshine42', 'sunshine42'), MISMATCH);
  assert.equal(passwordError('Sunshine42', ''), MISMATCH);
  assert.equal(passwordError('Sunshine42', 'Sunshine42'), null);
});

test('a short password reports length even when the confirmation differs', () => {
  assert.equal(passwordError('abc', 'xyz'), TOO_SHORT);
});
