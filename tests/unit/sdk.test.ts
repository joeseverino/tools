import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CliError, exitCodeFor } from '../../lib/sdk/cli.ts';
import { errorMessage, isRecord, isStringArray, parseJson } from '../../lib/sdk/guards.ts';
import { run, runJson, spawnJson } from '../../lib/sdk/process.ts';

const node = process.execPath;

test('guards accept only what they name', () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isStringArray(['a']), true);
  assert.equal(isStringArray(['a', 1]), false);
  assert.equal(parseJson('{"a":1}') !== undefined, true);
  assert.equal(parseJson('{'), undefined);
  assert.equal(errorMessage(new Error('x')), 'x');
  assert.equal(errorMessage('y'), 'y');
});

test('exitCodeFor maps CliError, parseArgs rejections and the fallback', () => {
  assert.equal(exitCodeFor(new CliError('x', 7)), 7);
  assert.equal(exitCodeFor(Object.assign(new TypeError('x'), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' })), 2);
  assert.equal(exitCodeFor(new Error('x')), 1);
  assert.equal(exitCodeFor(new Error('x'), 3), 3);
});

test('run reports status and stderr', () => {
  const ok = run(node, ['-e', 'process.stdout.write("hi")']);
  assert.equal(ok.ok, true);
  assert.equal(ok.stdout, 'hi');
  const bad = run(node, ['-e', 'console.error("nope"); process.exit(3)']);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 3);
  assert.equal(bad.error, 'nope');
});

test('runJson parses stdout and applies the guard', () => {
  const emit = (json: string): string[] => ['-e', `process.stdout.write(${JSON.stringify(json)})`];
  const parsed = runJson(node, emit('{"ok":true,"n":2}'));
  assert.deepEqual(parsed.json, { ok: true, n: 2 });

  const guarded = runJson(node, emit('{"n":2}'), {}, (value): value is { n: number } => isRecord(value) && typeof value['n'] === 'number');
  assert.equal(guarded.ok, true);
  assert.equal(guarded.json?.n, 2);

  const rejected = runJson(node, emit('{"n":"x"}'), {}, (value): value is { n: number } => isRecord(value) && typeof value['n'] === 'number');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.json, null);
  assert.match(rejected.error, /unexpected JSON shape/);

  const invalid = runJson(node, emit('not json'));
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /invalid JSON/);

  const failed = runJson(node, ['-e', 'process.exit(1)']);
  assert.equal(failed.ok, false);
});

test('spawnJson matches runJson', async () => {
  const good = await spawnJson(node, ['-e', 'process.stdout.write("[1,2]")'], {}, (value): value is number[] => Array.isArray(value));
  assert.equal(good.ok, true);
  assert.deepEqual(good.json, [1, 2]);
  const missing = await spawnJson('/nonexistent/binary-for-test');
  assert.equal(missing.ok, false);
  assert.equal(missing.json, null);
});
