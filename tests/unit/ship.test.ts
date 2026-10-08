import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { shipGate } from '../../lib/ship/gate.ts';
import { parseShipArgs, previewAction } from '../../lib/ship/main.ts';
import { shipRows } from '../../lib/ship/plan.ts';

const demo = { name: 'tools', path: '/tmp/tools', branch: 'ship/demo', dirty: 0, untracked: 0, ahead: 0, has_remote: true, upstream: true };

test('a clean pushed feature branch is planned only when PR creation is requested', () => {
  assert.deepEqual(shipRows([demo], true), [{ name: 'tools', path: '/tmp/tools', branch: 'ship/demo', uncommitted: 0, ahead: 0, hasRemote: true }]);
  assert.deepEqual(shipRows([demo], false), []);
});

test('dirty, untracked, ahead and unpublished repos are planned; local-ok repos without upstream are not', () => {
  const base = { name: 'r', path: '/r', branch: 'main', has_remote: true, upstream: true };
  assert.equal(shipRows([{ ...base, dirty: 1 }], false)[0]?.uncommitted, 1);
  assert.equal(shipRows([{ ...base, untracked: 2 }], false)[0]?.uncommitted, 2);
  assert.equal(shipRows([{ ...base, ahead: 3 }], false)[0]?.ahead, 3);
  assert.equal(shipRows([{ ...base, upstream: false }], false).length, 1);
  assert.equal(shipRows([{ ...base, upstream: false, local_ok: true }], false).length, 0);
});

test('a clean feature branch is never planned from main, master or an unborn branch', () => {
  for (const branch of ['main', 'master', '-']) assert.deepEqual(shipRows([{ ...demo, branch }], true), []);
});

test('previewAction describes commit, branch cut, push, and PR', () => {
  const row = { name: 'r', path: '/r', branch: 'main', uncommitted: 2, ahead: 1, hasRemote: true };
  assert.equal(previewAction(row, false), 'commit 2 · fresh branch · push ↑1 · PR');
  assert.equal(previewAction(row, true), 'commit 2 · fresh branch · push ↑1');
  assert.equal(previewAction({ ...row, hasRemote: false, branch: 'feat' }, false), 'commit 2 · no remote — skip');
});

test('parseShipArgs reads flags, values, the name and paths after --', () => {
  const unknown = (flag: string): never => {
    throw new Error(`unknown ${flag}`);
  };
  const opts = parseShipArgs(['tools', '--go', '-m', 'feat: x', '--body', '', '--no-pr', '--', 'a', 'b'], unknown);
  assert.equal(opts.name, 'tools');
  assert.equal(opts.go, true);
  assert.equal(opts.message, 'feat: x');
  assert.equal(opts.bodySet, true);
  assert.equal(opts.body, '');
  assert.equal(opts.noPr, true);
  assert.deepEqual(opts.paths, ['a', 'b']);
  assert.throws(() => parseShipArgs(['--bogus'], unknown), /unknown --bogus/);
});

function repoWith(files: Record<string, string>, executable: string[] = []): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ship-gate-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  for (const name of executable) chmodSync(path.join(dir, name), 0o755);
  return dir;
}

test('shipGate picks the tools gate, then scripts/check.sh, then a package script', () => {
  assert.deepEqual(shipGate(repoWith({ 'bin/tools': '#!/bin/sh\n' }, ['bin/tools'])), ['tools', 'check', '--ci', '--no-bench']);
  assert.deepEqual(shipGate(repoWith({ 'scripts/check.sh': 'true\n' })), ['bash', 'scripts/check.sh']);
  assert.deepEqual(shipGate(repoWith({ 'package.json': '{"scripts":{"check":"x","test":"y"}}' })), ['npm', 'run', 'check']);
  assert.deepEqual(shipGate(repoWith({ 'package.json': '{"scripts":{"test":"y"}}', 'pnpm-lock.yaml': '' })), ['pnpm', 'run', 'test']);
  assert.deepEqual(shipGate(repoWith({ 'package.json': '{"scripts":{"test":"y"}}', 'yarn.lock': '' })), ['yarn', 'test']);
  assert.deepEqual(shipGate(repoWith({ 'package.json': '{"scripts":{"test":"y"}}', 'bun.lock': '' })), ['bun', 'run', 'test']);
});

test('shipGate is null without a gate or with an unreadable package.json', () => {
  assert.equal(shipGate(repoWith({ 'README.md': '' })), null);
  assert.equal(shipGate(repoWith({ 'package.json': '{"scripts":{}}' })), null);
  assert.equal(shipGate(repoWith({ 'package.json': 'not json' })), null);
});
