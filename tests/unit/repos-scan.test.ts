import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectRepo, detectLang, detectPm, icloudDuplicates, needsFlags, packageManagerField } from '../../lib/repos/collect.ts';
import type { CollectOptions } from '../../lib/repos/collect.ts';
import { parseFlags } from '../../lib/repos/main.ts';
import type { ParsedRecord } from '../../lib/repos/record.ts';
import { renderTable, statusText } from '../../lib/repos/render.ts';
import { jobsFor, mapLimit } from '../../lib/repos/scan.ts';

const options: CollectOptions = { fetch: false, sizes: false, icloud: false, pm: '', dirty: false, unpushed: false, localOk: [] };

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'repos-scan-'));
}

function touch(file: string, text = ''): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function record(overrides: Partial<ParsedRecord> = {}): ParsedRecord {
  return {
    name: 'tools', root: 'Assets', path: '/c/tools', git: true, branch: 'main', remote: 'r', has_remote: true,
    dirty: 0, untracked: 0, ahead: 0, behind: 0, upstream: true, upstream_name: 'origin/main', upstream_track: '',
    upstream_gone: false, sha: 'abc', date: '2026-01-02', subject: 'feat: x', lang: 'node', pm: 'npm',
    package_manager: '-', nvmrc: '-', node_modules: false, node_modules_size: null, ci: 0, icloud_dups: 0, stash: 0,
    local_ok: false, needs_ship: false, needs_resync: false, needs_attention: false, branch_state: 'current',
    ...overrides,
  };
}

test('detectPm follows lockfile precedence and falls back to none for a bare package.json', () => {
  const dir = tmp();
  assert.equal(detectPm(dir), '-');
  touch(path.join(dir, 'package.json'), '{}');
  assert.equal(detectPm(dir), 'none');
  touch(path.join(dir, 'bun.lock'));
  assert.equal(detectPm(dir), 'bun');
  touch(path.join(dir, 'yarn.lock'));
  assert.equal(detectPm(dir), 'yarn');
  touch(path.join(dir, 'package-lock.json'));
  assert.equal(detectPm(dir), 'npm');
  touch(path.join(dir, 'pnpm-lock.yaml'));
  assert.equal(detectPm(dir), 'pnpm');
});

test('detectLang reads manifests, then bin/ or *.sh, else other', () => {
  const dir = tmp();
  assert.equal(detectLang(dir), 'other');
  touch(path.join(dir, 'bin', 'tool'));
  assert.equal(detectLang(dir), 'bash');
  touch(path.join(dir, 'Cargo.toml'));
  assert.equal(detectLang(dir), 'rust');
  touch(path.join(dir, 'go.mod'));
  assert.equal(detectLang(dir), 'go');
  touch(path.join(dir, 'requirements.txt'));
  assert.equal(detectLang(dir), 'python');
  touch(path.join(dir, 'package.json'));
  assert.equal(detectLang(dir), 'node');
  const hidden = tmp();
  touch(path.join(hidden, 'bin', '.keep'));
  assert.equal(detectLang(hidden), 'other');
});

test('packageManagerField extracts the declared value', () => {
  assert.equal(packageManagerField('{"packageManager": "npm@11.19.0"}'), 'npm@11.19.0');
  assert.equal(packageManagerField('{"packageManager":"pnpm@9"}'), 'pnpm@9');
  assert.equal(packageManagerField('{"name":"x"}'), '-');
});

test('icloudDuplicates counts "name N.ext" files outside node_modules and .git', () => {
  const dir = tmp();
  touch(path.join(dir, 'note 2.md'));
  touch(path.join(dir, 'sub', 'y 4.txt'));
  touch(path.join(dir, 'z 12.txt'));
  touch(path.join(dir, 'plain.txt'));
  touch(path.join(dir, 'node_modules', 'p', 'x 3.js'));
  touch(path.join(dir, '.git', 'w 5.txt'));
  assert.equal(icloudDuplicates(dir), 2);
});

test('needsFlags derives ship, resync and attention from the git facts', () => {
  const base = { dirty: 0, untracked: 0, ahead: 0, behind: 0, upstream: true, upstream_gone: false, has_remote: true, local_ok: false };
  assert.deepEqual(needsFlags(base), { needs_ship: false, needs_resync: false, needs_attention: false });
  assert.equal(needsFlags({ ...base, untracked: 1 }).needs_ship, true);
  assert.equal(needsFlags({ ...base, upstream: false }).needs_ship, true);
  assert.equal(needsFlags({ ...base, upstream: false, local_ok: true }).needs_ship, false);
  assert.equal(needsFlags({ ...base, behind: 2 }).needs_resync, true);
  assert.equal(needsFlags({ ...base, has_remote: false, upstream: false }).needs_attention, true);
  assert.equal(needsFlags({ ...base, has_remote: false, upstream: false, local_ok: true }).needs_attention, false);
});

test('collectRepo skips plain directories and applies the filters', () => {
  const root = tmp();
  const plain = path.join(root, 'plain');
  touch(path.join(plain, 'f'));
  assert.equal(collectRepo({ dir: plain, name: 'plain', root: 'r', options }), null);

  const goOnly = path.join(root, 'goonly');
  touch(path.join(goOnly, 'go.mod'));
  const found = collectRepo({ dir: goOnly, name: 'goonly', root: 'r', options });
  assert.equal(found?.git, false);
  assert.equal(found?.branch, '-');
  assert.equal(found?.needs_attention, true);
  assert.equal(collectRepo({ dir: goOnly, name: 'goonly', root: 'r', options: { ...options, pm: 'npm' } }), null);
  assert.equal(collectRepo({ dir: goOnly, name: 'goonly', root: 'r', options: { ...options, dirty: true } }), null);
  assert.equal(collectRepo({ dir: goOnly, name: 'goonly', root: 'r', options: { ...options, localOk: ['goonly'], unpushed: true } }), null);
});

test('collectRepo reads a real git repo', () => {
  const root = tmp();
  const dir = path.join(root, 'demo');
  mkdirSync(dir);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, ...args], { env, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  touch(path.join(dir, 'a.txt'), 'x');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: one');
  touch(path.join(dir, 'b.txt'), 'y');
  const rec = collectRepo({ dir, name: 'demo', root: 'r', options });
  assert.equal(rec?.git, true);
  assert.equal(rec?.branch, 'main');
  assert.equal(rec?.untracked, 1);
  assert.equal(rec?.subject, 'feat: one');
  assert.equal(rec?.has_remote, false);
  assert.equal(rec?.branch_state, '-');
});

test('jobsFor prefers an exact name over substring and skips hidden entries', () => {
  const root = tmp();
  for (const name of ['cordon', 'cordon-starter', '.hidden']) mkdirSync(path.join(root, name));
  touch(path.join(root, 'file'));
  symlinkSync(path.join(root, 'cordon'), path.join(root, 'linked'));
  const names = (nameFilter: string): string[] => jobsFor({ roots: [root, `${root}/missing`], nameFilter, options }).map((job) => job.name);
  assert.deepEqual(names('cordon'), ['cordon']);
  assert.deepEqual(names('cord').sort(), ['cordon', 'cordon-starter']);
  assert.ok(names('').includes('linked'));
  assert.ok(!names('').includes('.hidden') && !names('').includes('file'));
});

test('mapLimit keeps order and bounds concurrency', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2);
});

test('parseFlags: interleaved flags, last name wins, value flags need a value', () => {
  const reject = (_token: string): never => {
    throw new Error('rejected');
  };
  const parsed = parseFlags(['first', '--json', '--pm', 'npm', '--root', '/a', '--root', '/b', 'second', 'tui', '--prs'], reject, ['x']);
  assert.ok(!('exit' in parsed));
  if ('exit' in parsed) return;
  assert.equal(parsed.nameFilter, 'second');
  assert.deepEqual([parsed.json, parsed.tui, parsed.prs, parsed.options.pm, parsed.roots], [true, true, true, 'npm', ['/a', '/b']]);
  assert.deepEqual(parsed.options.localOk, ['x']);
  assert.deepEqual(parseFlags(['--pm'], reject, []), { exit: 1 });
  assert.throws(() => parseFlags(['--nope'], reject, []), /rejected/);
});

test('statusText and renderTable format the human table', () => {
  assert.equal(statusText(record()), 'clean');
  assert.equal(statusText(record({ has_remote: false })), 'local');
  assert.equal(statusText(record({ has_remote: false, local_ok: true })), 'local-ok');
  assert.equal(statusText(record({ dirty: 1, untracked: 2, ahead: 3, behind: 4, stash: 5, upstream_gone: true })), '±1 ?2 ↑3 ↓4 ⚑5 gone');

  const plain = renderTable([record({ name: 'x'.repeat(30), subject: 'y'.repeat(50), ci: 2, needs_attention: true, dirty: 1 })], null).split('\n');
  assert.equal(plain[0], '  REPO                   ROOT      PM     STATUS            CI   LAST COMMIT');
  assert.equal(plain[1], `  ${'x'.repeat(21)}… Assets    npm    ±1                2    2026-01-02 ${'y'.repeat(41)}…`);
  assert.equal(plain[3], '  summary    1 repos · 1 dirty · 1 unpushed');

  const withPr = renderTable([record(), record({ name: 'b' })], [{ number: 12, state: 'open', ci: 'passing', review: 'none', url: '' }, { number: 0, state: 'none', ci: 'none', review: 'none', url: '' }]).split('\n');
  assert.match(withPr[0] ?? '', /CI {3}PR {12}LAST COMMIT$/);
  assert.match(withPr[1] ?? '', /-    #12 passing   2026-01-02 feat: x$/);
  assert.match(withPr[2] ?? '', /-    -             2026-01-02 feat: x$/);
});
