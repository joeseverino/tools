import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CheckReport } from '../../lib/sdk/report.ts';
import { cbmEnv, handshakeVerdict, olderThanDays, orphanedSockets, reaperExposed, runtimeDirs, staleLogs, workerLogs } from '../../lib/cbm/state.ts';

function fixture(): ReturnType<typeof cbmEnv> {
  const root = mkdtempSync(path.join(tmpdir(), 'cbm-unit-'));
  return cbmEnv({ CBM_TMP_DIR: path.join(root, 'tmp'), CBM_CACHE_DIR: path.join(root, 'cache'), HOME: root }, 501);
}

function touch(file: string, ageDays = 0): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  const when = new Date(Date.now() - ageDays * 86_400_000);
  utimesSync(file, when, when);
}

test('cbmEnv derives the cache and log dirs from XDG_CACHE_HOME or HOME', () => {
  assert.equal(cbmEnv({ HOME: '/h' }, 1).cacheDir, '/h/.cache/codebase-memory-mcp');
  assert.equal(cbmEnv({ HOME: '/h', XDG_CACHE_HOME: '/x' }, 1).logDir, '/x/codebase-memory-mcp/logs');
  assert.equal(cbmEnv({ CBM_CACHE_DIR: '/c', HOME: '/h' }, 1).logDir, '/c/logs');
});

test('runtime dirs cover the tmp, cache and recovery locations that exist', () => {
  const env = fixture();
  touch(path.join(env.tmpDir, 'cbm-daemon-501', 'a.sock'));
  touch(path.join(env.cacheDir, 'runtime', 'cbm-daemon-501', 'b.sock'));
  touch(path.join(env.tmpDir, 'cbm-recovery-1', 'cbm-daemon-9', 'c.sock'));
  assert.equal(runtimeDirs(env).length, 3);
});

test('a socket without an identity file is orphaned', () => {
  const env = fixture();
  const dir = path.join(env.tmpDir, 'cbm-daemon-501');
  touch(path.join(dir, 'live.sock'));
  touch(path.join(dir, 'live.sock.identity'));
  touch(path.join(dir, 'dead.sock'));
  assert.deepEqual(orphanedSockets(env), [path.join(dir, 'dead.sock')]);
});

test('find -mtime +N semantics: whole 24h periods strictly above N', () => {
  const now = Date.now();
  assert.equal(olderThanDays(now - 2.9 * 86_400_000, 2, now), false);
  assert.equal(olderThanDays(now - 3.1 * 86_400_000, 2, now), true);
});

test('reaper exposure counts only old identity files under cbm-daemon dirs', () => {
  const env = fixture();
  const dir = path.join(env.tmpDir, 'cbm-daemon-501');
  touch(path.join(dir, 'old.sock.identity'), 5);
  touch(path.join(dir, 'new.sock.identity'), 0);
  touch(path.join(dir, 'old.sock'), 5);
  assert.deepEqual(reaperExposed(env), [path.join(dir, 'old.sock.identity')]);
});

test('worker logs are found by name and pruned by whole-day age', () => {
  const env = fixture();
  touch(path.join(env.logDir, '.worker-log-old'), 20);
  touch(path.join(env.logDir, '.worker-log-new'), 1);
  touch(path.join(env.logDir, 'other.log'), 40);
  const logs = workerLogs(env);
  assert.equal(logs.length, 2);
  assert.deepEqual(staleLogs(logs, '14').map((log) => path.basename(log.path)), ['.worker-log-old']);
  assert.deepEqual(staleLogs(logs, 'abc'), []);
});

test('the handshake verdict needs a finished process that answered with a result', () => {
  assert.equal(handshakeVerdict(false, '{"result":{}}'), 'timeout');
  assert.equal(handshakeVerdict(true, '{"jsonrpc":"2.0","result":{}}'), 'ok');
  assert.equal(handshakeVerdict(true, 'nope'), 'fail');
});

test('CheckReport collects JSON entries and fails the run on a failed check', () => {
  const report = new CheckReport(true);
  assert.equal(report.check('a', true, 'fine'), true);
  assert.equal(report.check('b', false, 'bad'), false);
  report.warn('c', 'meh');
  assert.deepEqual(report.entries, [
    { label: 'a', ok: true, detail: 'fine' },
    { label: 'b', ok: false, detail: 'bad' },
    { label: 'c', ok: true, warning: true, detail: 'meh' },
  ]);
});
