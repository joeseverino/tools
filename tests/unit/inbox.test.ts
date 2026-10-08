import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstContentLine, noteBody, slugify, timestamps } from '../../lib/inbox/main.ts';

test('slugify keeps the first line, swaps path-hostile characters, and caps at 50', () => {
  assert.equal(slugify('remember the milk'), 'remember the milk');
  assert.equal(slugify('a/b\\c:d?e*f<g>h|i"j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(slugify('first\nsecond'), 'first');
  assert.equal(slugify('  padded  '), 'padded');
  assert.equal(slugify('x'.repeat(80)).length, 50);
  assert.equal(slugify(`${'y'.repeat(49)} tail`), 'y'.repeat(49));
});

test('firstContentLine skips frontmatter and blank lines', () => {
  assert.equal(firstContentLine('---\ndoc_id: x\n---\n\n  \nhello\nworld\n'), 'hello');
  assert.equal(firstContentLine('---\ndoc_id: x\n---\n'), '');
});

test('noteBody writes doc_id and created frontmatter, then the text', () => {
  assert.equal(noteBody('20260101-120000', '2026-01-01 12:00:00', 'hi'), '---\ndoc_id: inbox-20260101-120000\ncreated: 2026-01-01 12:00:00\n---\n\nhi\n');
  assert.equal(noteBody('i', 'c', ''), '---\ndoc_id: inbox-i\ncreated: c\n---\n\n');
});

test('timestamps derive file name, id and created from one instant', () => {
  const stamps = timestamps(new Date(2026, 0, 2, 3, 4, 5));
  assert.deepEqual(stamps, { timestamp: '2026-01-02 030405', docId: '20260102-030405', created: '2026-01-02 03:04:05' });
});
