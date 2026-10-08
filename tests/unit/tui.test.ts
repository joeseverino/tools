import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env['FORCE_COLOR'] = '1';
delete process.env['NO_COLOR'];
const tui = await import('../../lib/tui.ts');

test('cellWidth: control, combining, narrow, wide, emoji', () => {
  assert.equal(tui.cellWidth(''), 0);
  assert.equal(tui.cellWidth('́'), 0);
  assert.equal(tui.cellWidth('a'), 1);
  assert.equal(tui.cellWidth('é'), 1);
  assert.equal(tui.cellWidth('漢'), 2);
  assert.equal(tui.cellWidth('👍'), 2);
});

test('displayWidth ignores CSI and OSC sequences and counts graphemes', () => {
  assert.equal(tui.displayWidth(''), 0);
  assert.equal(tui.displayWidth('abc'), 3);
  assert.equal(tui.displayWidth('\x1b[1mbold\x1b[0m'), 4);
  assert.equal(tui.displayWidth('\x1b[38;5;196mred\x1b[39m'), 3);
  assert.equal(tui.displayWidth('\x1b]0;title\x07x'), 1);
  assert.equal(tui.displayWidth('\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\'), 4);
  assert.equal(tui.displayWidth('\x1b[?25ha\x1b[?25l'), 1);
  assert.equal(tui.displayWidth('漢字'), 4);
  assert.equal(tui.displayWidth('👍🏽'), 2);
  assert.equal(tui.displayWidth('ｱｲｳ'), 3);
  assert.equal(tui.displayWidth(42), 2);
});

test('prefixByWidth and suffixByWidth cut on grapheme boundaries', () => {
  assert.equal(tui.prefixByWidth('漢字abc', 5), '漢字a');
  assert.equal(tui.prefixByWidth('漢字', 3), '漢');
  assert.equal(tui.suffixByWidth('abc漢字', 5), 'c漢字');
  assert.equal(tui.suffixByWidth('abc', 0), '');
});

test('truncate and padEndAnsi respect display width', () => {
  assert.equal(tui.truncate('abc', 3), 'abc');
  assert.equal(tui.truncate('漢字', 3), '漢\x1b[0m…');
  assert.equal(tui.padEndAnsi('abc', 6), 'abc   ');
  assert.equal(tui.padEndAnsi('漢字', 6), '漢字  ');
});

test('clipAnsi keeps escapes and resets after a clip', () => {
  assert.equal(tui.clipAnsi('abc', 2), 'ab\x1b[0m');
  assert.equal(tui.clipAnsi('abc', 3), 'abc');
  assert.equal(tui.clipAnsi('\x1b[1mbold\x1b[0m', 4), '\x1b[1mbold\x1b[0m');
  assert.equal(tui.clipAnsi('abc', 0), '');
});

test('wrapText wraps on words and hard-splits an overlong word', () => {
  assert.deepEqual(tui.wrapText('the quick brown fox jumps over the lazy dog', 10),
    ['the quick', 'brown fox', 'jumps over', 'the lazy', 'dog']);
  assert.deepEqual(tui.wrapText('abcdefgh', 3), ['abc', 'def', 'gh']);
  assert.deepEqual(tui.wrapText('', 10), ['']);
  assert.deepEqual(tui.wrapText('x', 0), ['']);
});

test('editQuery edits at grapheme boundaries', () => {
  const model = { query: 'ab', queryCursor: 2 };
  tui.editQuery(model, 'c');
  assert.deepEqual(model, { query: 'abc', queryCursor: 3 });
  tui.editQuery(model, '\x7f');
  assert.deepEqual(model, { query: 'ab', queryCursor: 2 });
  tui.editQuery(model, '\x1b[D');
  assert.equal(model.queryCursor, 1);
  tui.editQuery(model, '\x15');
  assert.deepEqual(model, { query: '', queryCursor: 0 });
});

test('createInputPump splits keys, CSI sequences and bracketed paste', () => {
  const keys: string[] = [];
  const pastes: string[] = [];
  const pump = tui.createInputPump({ onKey: (key) => keys.push(key), onPaste: (text) => pastes.push(text) });
  pump.feedInput('a\x1b[Bb\x1b[200~pasted\x1b[201~c');
  pump.flushInput();
  assert.deepEqual(keys, ['a', '\x1b[B', 'b', 'c']);
  assert.deepEqual(pastes, ['pasted']);
});

test('fitFrame windows a tall frame around the cursor row', () => {
  const frame = Array.from({ length: 30 }, (_, i) => (i === 15 ? '▸ row' : `row ${i}`)).join('\n');
  const fitted = tui.fitFrame(frame, 40, 12).split('\n');
  assert.equal(fitted.length, 12);
  assert.ok(fitted.some((line) => line.includes('▸')));
});

test('palette is the SGR escape when colour is forced', () => {
  assert.equal(tui.BOLD, '\x1b[1m');
  assert.equal(tui.DIM, '\x1b[2m');
  assert.equal(tui.INVERT, '\x1b[7m');
  assert.equal(tui.RESET, '\x1b[0m');
  assert.equal(tui.GREEN, '\x1b[32m');
  assert.equal(tui.RED, '\x1b[31m');
});

test('loadError appends trimmed stderr only when present', () => {
  assert.equal(tui.loadError('`x`', '').message, 'could not load `x`');
  assert.equal(tui.loadError('`x`', ' boom\n').message, 'could not load `x`: boom');
});
