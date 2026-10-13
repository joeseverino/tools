import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redDetail } from '../../lib/gate-preview/main.ts';
import { digestInput, parseBriefArgs } from '../../lib/brief/main.ts';

function fail(kind: string, token: string): never {
  throw new Error(`${kind}:${token}`);
}

test('parseBriefArgs reads flags and defaults the window to 7 days', () => {
  assert.deepEqual(parseBriefArgs([], fail), { json: false, prs: false, days: '7', tui: false });
  assert.deepEqual(parseBriefArgs(['--json', '--prs', '--days', '3'], fail), { json: true, prs: true, days: '3', tui: false });
  assert.equal(parseBriefArgs(['tui'], fail).tui, true);
  assert.equal(parseBriefArgs(['--tui'], fail).tui, true);
});

test('parseBriefArgs routes unknown tokens to the usage error', () => {
  assert.throws(() => parseBriefArgs(['--nope'], fail), /option:--nope/);
  assert.throws(() => parseBriefArgs(['stray'], fail), /argument:stray/);
});

test('digestInput embeds each already-serialized part verbatim', () => {
  const text = digestInput({ repos: '{"a":1}', vault: 'null', writeups: '[]', sections: '[]' });
  assert.deepEqual(JSON.parse(text), { repos: { a: 1 }, vault: null, writeups: [], sections: [] });
});

test('gate-preview shows a red row without its RED prefix', () => {
  assert.equal(redDetail('RED a,b'), 'a,b');
  assert.equal(redDetail('ERROR no verdict'), 'ERROR no verdict');
});
