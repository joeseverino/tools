import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ciPath, pathWithout } from '../../lib/sdk/ci.ts';
import { resultError, resultOk } from '../../lib/sdk/result.ts';
import { CheckReport, tail } from '../../lib/sdk/report.ts';
import { sourceSignature } from '../../lib/tools/federate.ts';
import { launcher, scaffold, toolSource } from '../../lib/tools/scaffold.ts';
import { which } from '../../lib/sdk/which.ts';
import { spec as toolsSpec, tool as toolsTool } from '../../lib/tools/main.ts';
import { definitionDrift } from '../../lib/sdk/tool.ts';

function capture(fn: () => void): string {
  const write = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string | Uint8Array) => ((out += String(chunk)), true)) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = write;
  }
  return out;
}

test('pathWithout drops every instance of a directory and empty segments', () => {
  assert.equal(pathWithout('/a', '/a:/b:/a:/c'), '/b:/c');
  assert.equal(pathWithout('/nope', '/x::/y'), '/x:/y');
});

test('ciPath puts the checkout bin first, once, with the install dir removed', () => {
  const value = ciPath('/repo', '/usr/bin:/home/me/.local/bin:/repo/bin', '/home/me/.local/bin');
  assert.equal(value, '/repo/bin:/usr/bin');
  assert.equal(ciPath('/repo', value, '/home/me/.local/bin'), value);
});

test('result envelopes keep the result-v1 key order', () => {
  assert.equal(resultOk({ value: 1 }), '{"ok":true,"result_version":1,"data":{"value":1},"warnings":[],"receipt":null,"next":[]}\n');
  assert.equal(resultOk(null, { warnings: ['partial sync'] }), '{"ok":true,"result_version":1,"data":null,"warnings":["partial sync"],"receipt":null,"next":[]}\n');
  assert.equal(
    resultError('stale_plan', 'reload', true, { id: 1 }),
    '{"ok":false,"result_version":1,"error":{"code":"stale_plan","message":"reload","retryable":true,"details":{"id":1}}}\n',
  );
  assert.equal(resultError('x', 'y'), '{"ok":false,"result_version":1,"error":{"code":"x","message":"y","retryable":false}}\n');
});

test('doctor records JSON entries in the documented shape and returns the exit code', () => {
  const doctor = new CheckReport(true);
  assert.equal(doctor.check('git', true, '/usr/bin/git'), true);
  assert.equal(doctor.check('rsync', false, 'not installed'), false);
  doctor.warn('node_modules', 'missing');
  const out = capture(() => assert.equal(doctor.finish(true), 1));
  assert.equal(
    out,
    '{"ok":false,"checks":[{"label":"git","ok":true,"detail":"/usr/bin/git"},{"label":"rsync","ok":false,"detail":"not installed"},{"label":"node_modules","ok":true,"warning":true,"detail":"missing"}]}\n',
  );
});

test('doctor text mode prints status lines and the verdict', () => {
  const doctor = new CheckReport(false);
  const out = capture(() => {
    doctor.check('git', true, '/usr/bin/git');
    doctor.check('uv', false, 'not installed');
    doctor.warn('node', 'absent');
    assert.equal(doctor.finish(false), 0);
  });
  assert.match(out, /^ {2}ok {9}git \(\/usr\/bin\/git\)\n {2}missing {4}uv \(not installed\)\n {2}warn {7}node \(absent\)\n\n {2}doctor {4}all checks passed\n\n$/);
});

test('a gate records the duration on success and the last output line on failure', () => {
  const doctor = new CheckReport(true);
  assert.equal(doctor.gate('ok gate', ['true']), true);
  assert.equal(doctor.gate('bad gate', ['sh', '-c', 'echo first; echo "  last words"; exit 3']), false);
  assert.match(doctor.entries[0]?.detail ?? '', /^\d+s$/);
  assert.match(doctor.entries[1]?.detail ?? '', /^exit 3 in \d+s — last words$/);
});

test('tail returns the last lines of the output', () => {
  assert.deepEqual(tail('a\nb\nc\nd\n', 2), ['c', 'd']);
  assert.deepEqual(tail('only', 6), ['only']);
});

test('which resolves executables on a search path only', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'which-'));
  const file = path.join(dir, 'runme');
  writeFileSync(file, '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(path.join(dir, 'plain'), 'x');
  assert.equal(which('runme', dir), file);
  assert.equal(which('plain', dir), null);
  assert.equal(which('missing', dir), null);
});

test('scaffold writes an executable launcher and a typed tool module', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'scaffold-'));
  mkdirSync(path.join(home, 'bin'));
  const order = scaffold(home, 'demo', false, JSON.stringify({ tools: [{ order: 10 }, { order: 40 }] }));
  assert.equal(order, 50);
  assert.equal(readFileSync(path.join(home, 'bin/demo'), 'utf8'), launcher('demo'));
  assert.ok((statSync(path.join(home, 'bin/demo')).mode & 0o111) !== 0);
  assert.equal(readFileSync(path.join(home, 'lib/demo/main.ts'), 'utf8'), toolSource('demo', 50));
});

test('the source signature changes when a tool or library file changes', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sig-'));
  mkdirSync(path.join(home, 'bin'));
  mkdirSync(path.join(home, 'lib'));
  writeFileSync(path.join(home, 'bin/t'), 'one');
  writeFileSync(path.join(home, 'lib/spec.ts'), 'a');
  const before = sourceSignature(home, false);
  assert.equal(sourceSignature(home, false), before);
  writeFileSync(path.join(home, 'lib/spec.ts'), 'b');
  assert.notEqual(sourceSignature(home, false), before);
});

test('the tools spec and its handlers cover the same commands', () => {
  assert.deepEqual(definitionDrift(toolsTool), []);
  assert.equal(toolsSpec.commands?.length, 11);
});
