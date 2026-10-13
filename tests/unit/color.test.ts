import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const probe = `
  const { open, paint } = await import('./lib/sdk/color.ts');
  process.stdout.write(JSON.stringify([open('bold'), paint('green', 'x')]));
`;

function colorOutput(env: Record<string, string>): unknown {
  const base = { ...process.env };
  delete base['FORCE_COLOR'];
  delete base['NO_COLOR'];
  delete base['NODE_DISABLE_COLORS'];
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: new URL('../..', import.meta.url),
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('colour is off when stdout is not a TTY', () => {
  assert.deepEqual(colorOutput({}), ['', 'x']);
});

test('colour is off under NO_COLOR', () => {
  assert.deepEqual(colorOutput({ NO_COLOR: '1' }), ['', 'x']);
});

test('FORCE_COLOR turns colour on without a TTY', () => {
  assert.deepEqual(colorOutput({ FORCE_COLOR: '1' }), ['\x1b[1m', '\x1b[32mx\x1b[39m']);
});
