import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadShellFile } from '../../lib/sdk/config.ts';
import { runCombined } from '../../lib/sdk/process.ts';

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'tools-unit-'));
}

test('shell config: set, empty and unset scalars and arrays are read as declared', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'config.sh');
    writeFileSync(file, 'SET=hello\nEMPTY=\nFULL=(a "b c" d)\nNONE=()\n');
    const config = loadShellFile(file, { scalars: ['SET', 'EMPTY', 'UNSET'], arrays: ['FULL', 'NONE', 'MISSING'] });
    assert.deepEqual(config.scalars, { SET: 'hello', EMPTY: '' });
    assert.deepEqual(config.arrays, { FULL: ['a', 'b c', 'd'], NONE: [], MISSING: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell config: a variable name that is not an identifier is refused before any shell runs', () => {
  assert.throws(() => loadShellFile('/dev/null', { scalars: ['A; touch x'] }), /invalid config variable/);
});

test('runCombined: stdout and stderr share one stream and keep their order', () => {
  const result = runCombined('sh', ['-c', 'echo one; echo two >&2; echo three']);
  assert.equal(result.status, 0);
  assert.equal(result.output, 'one\ntwo\nthree\n');
});

test('runCombined: feeds input and reports the exit status', () => {
  const result = runCombined('sh', ['-c', 'cat; exit 3'], { input: 'piped' });
  assert.equal(result.status, 3);
  assert.equal(result.output, 'piped');
});
