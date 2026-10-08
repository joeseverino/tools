import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../../lib/start/main.ts';

test('slugify kebab-cases, trims dashes, and drops non-alphanumerics', () => {
  assert.equal(slugify('fix dns rewrites'), 'fix-dns-rewrites');
  assert.equal(slugify('  Fix: the DNS / rewrites!  '), 'fix-the-dns-rewrites');
  assert.equal(slugify('---'), '');
  assert.equal(slugify(''), '');
});
