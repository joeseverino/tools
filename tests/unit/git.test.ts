import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import * as lib from '../../lib/git/index.ts';

const stub = path.resolve(import.meta.dirname, '../fixtures/gh');
const saved = { ...process.env };

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(file: string, text = 'x\n'): void {
  writeFileSync(file, text);
}

function commitFile(cwd: string, name: string, message: string): void {
  write(path.join(cwd, name));
  sh(cwd, 'add', name);
  sh(cwd, 'commit', '-q', '-m', message);
}

let origin: string;
let work: string;
let root: string;

function setupFlow(): void {
  origin = path.join(root, 'origin.git');
  work = path.join(root, 'work');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'init', '-q', '-b', 'main', work);
  sh(work, 'config', 'user.email', 't@t.io');
  sh(work, 'config', 'user.name', 'tester');
  sh(work, 'remote', 'add', 'origin', origin);
  commitFile(work, 'a.txt', 'feat: one');
  sh(work, 'push', '-q', '-u', 'origin', 'main');
  try {
    sh(work, 'remote', 'set-head', 'origin', 'main');
  } catch {
    // the head is optional for these scenarios
  }
}

function advanceOrigin(): void {
  const other = path.join(root, 'other');
  sh(root, 'clone', '-q', origin, other);
  sh(other, 'config', 'user.email', 'o@o.io');
  sh(other, 'config', 'user.name', 'other');
  sh(other, 'checkout', '-q', '-B', 'main', 'origin/main');
  commitFile(other, 'b.txt', 'feat: move main');
  sh(other, 'push', '-q', 'origin', 'main');
  sh(work, 'fetch', '-q', 'origin');
}

function branchExists(name: string): boolean {
  try {
    sh(work, 'show-ref', '--verify', '--quiet', `refs/heads/${name}`);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'git-flow-'));
  process.env['GH_BIN'] = stub;
  process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
  process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  setupFlow();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe('branchState', () => {
  test('main is trunk', () => {
    assert.equal(lib.branchState(work, 'main'), 'trunk');
  });

  test('a branch with no unique commits is a zombie', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/empty', 'origin/main');
    assert.equal(lib.branchState(work, 'main'), 'zombie');
  });

  test('a start-cut branch (dirty, at base tip) is current and is kept by targetBranch', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/start-cut', 'origin/main');
    write(path.join(work, 'wip.txt'));
    assert.equal(lib.branchState(work, 'main'), 'current');
    assert.deepEqual(lib.targetBranch(work, 'main'), { code: lib.TARGET_OK, branch: 'feat/start-cut' });
  });

  test('a dirty branch behind base is still a zombie', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/old', 'origin/main');
    advanceOrigin();
    write(path.join(work, 'wip.txt'));
    assert.equal(lib.branchState(work, 'main'), 'zombie');
  });

  test('an up-to-date feature branch with commits is current', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/work', 'origin/main');
    commitFile(work, 'c.txt', 'feat: c');
    assert.equal(lib.branchState(work, 'main'), 'current');
  });

  test('committed work behind base with no PR is stale', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/old', 'origin/main');
    commitFile(work, 'c.txt', 'feat: c');
    advanceOrigin();
    assert.equal(lib.branchState(work, 'main'), 'stale');
  });

  test('a branch with an open PR is pr even when behind, and collapses to stale without the PR lookup', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/haspr', 'origin/main');
    commitFile(work, 'c.txt', 'feat: c');
    advanceOrigin();
    assert.equal(lib.branchState(work, 'main', true), 'pr');
    assert.equal(lib.branchState(work, 'main', false), 'stale');
  });
});

describe('targetBranch and rebranch', () => {
  test('a stale branch returns TARGET_STALE and nothing is recut', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/old', 'origin/main');
    commitFile(work, 'c.txt', 'feat: c');
    advanceOrigin();
    assert.equal(lib.targetBranch(work, 'main').code, lib.TARGET_STALE);
    assert.equal(sh(work, 'symbolic-ref', '--short', 'HEAD').trim(), 'feat/old');
  });

  test('on main it cuts a fresh branch carrying the working tree', () => {
    write(path.join(work, 'd.txt'), 'dirty\n');
    const target = lib.targetBranch(work, 'main', 'ship');
    assert.equal(target.code, lib.TARGET_OK);
    assert.match(target.branch, /^ship\/\d{8}-\d{6}$/);
    assert.notEqual(sh(work, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
    assert.ok(existsSync(path.join(work, 'd.txt')));
  });

  test('rebranch replays commits onto a fresh branch off the current base', () => {
    sh(work, 'checkout', '-q', '-b', 'feat/old', 'origin/main');
    commitFile(work, 'mine.txt', 'feat: mine');
    advanceOrigin();
    const fresh = lib.rebranch(work, 'main', 'ship');
    assert.ok(fresh?.startsWith('ship/'));
    sh(work, 'checkout', '-q', fresh ?? '');
    assert.ok(existsSync(path.join(work, 'mine.txt')));
    assert.ok(existsSync(path.join(work, 'b.txt')));
    assert.ok(Number(sh(work, 'rev-list', '--count', 'HEAD').trim()) >= 3);
  });
});

describe('syncClean and mergedBranches', () => {
  function pushThenDelete(name: string, file: string): void {
    sh(work, 'checkout', '-q', '-b', name, 'origin/main');
    commitFile(work, file, `feat: ${file}`);
    sh(work, 'push', '-q', '-u', 'origin', name);
  }

  test('prunes a squash-merged branch whose commits look diverged', () => {
    pushThenDelete('feat/wasmerged', 'sq.txt');
    sh(work, 'push', '-q', 'origin', '--delete', 'feat/wasmerged');
    sh(work, 'checkout', '-q', 'main');
    assert.equal(lib.syncClean(work, 'main'), true);
    assert.equal(branchExists('feat/wasmerged'), false);
  });

  test('keeps a genuinely diverged branch with no merged PR', () => {
    pushThenDelete('feat/diverged', 'd.txt');
    sh(work, 'push', '-q', 'origin', '--delete', 'feat/diverged');
    sh(work, 'checkout', '-q', 'main');
    lib.syncClean(work, 'main');
    assert.equal(branchExists('feat/diverged'), true);
  });

  test('steps off and prunes a squash-merged current branch', () => {
    pushThenDelete('feat/wasmerged', 'sq.txt');
    sh(work, 'push', '-q', 'origin', '--delete', 'feat/wasmerged');
    lib.syncClean(work, 'main');
    assert.equal(sh(work, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
    assert.equal(branchExists('feat/wasmerged'), false);
  });

  test('mergedBranches lists fully-merged branches, never base, current or unmerged', () => {
    pushThenDelete('feat/wasmerged', 'x.txt');
    pushThenDelete('feat/keepme', 'k.txt');
    sh(work, 'checkout', '-q', 'main');
    assert.deepEqual(lib.mergedBranches(work, 'main'), ['feat/wasmerged']);
  });

  test('mergedBranches protects a merged branch with commits ahead of its upstream', () => {
    pushThenDelete('feat/wasmerged', 'x.txt');
    commitFile(work, 'more.txt', 'feat: more');
    sh(work, 'checkout', '-q', 'main');
    assert.deepEqual(lib.mergedBranches(work, 'main'), []);
  });
});

describe('commit', () => {
  test('stagedIcloudConflicts matches "<stem> <n>[.ext]" duplicates only', () => {
    for (const name of ['a 2.mjs', 'b.mjs', 'c2.mjs', 'd 3']) write(path.join(work, name), '');
    sh(work, 'add', '-A');
    assert.deepEqual(lib.stagedIcloudConflicts(work).sort(), ['a 2.mjs', 'd 3']);
  });

  test('drops iCloud-conflict duplicates but keeps real files and leaves them on disk', () => {
    write(path.join(work, 'real.mjs'), 'real\n');
    write(path.join(work, 'real 2.mjs'), 'dupe\n');
    write(path.join(work, 'notes 3.bats'), 'dupe\n');
    assert.equal(lib.commit(work, 'feat: add real.mjs'), 0);
    const tree = sh(work, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
    assert.ok(tree.includes('real.mjs'));
    assert.ok(!tree.includes('real 2.mjs') && !tree.includes('notes 3.bats'));
    assert.ok(existsSync(path.join(work, 'real 2.mjs')) && existsSync(path.join(work, 'notes 3.bats')));
  });

  test('returns 1 when there is nothing to commit', () => {
    assert.equal(lib.commit(work, 'feat: nothing'), 1);
  });

  test('commitMessage derives a conventional subject from the staged top-level paths', () => {
    mkdirSync(path.join(work, 'docs'));
    write(path.join(work, 'docs', 'x.md'));
    write(path.join(work, 'README.md'));
    sh(work, 'add', '-A');
    assert.equal(lib.commitMessage(work), 'chore: update README.md,docs');
  });
});

test('conventionalSubject accepts release-please-friendly subjects only', () => {
  assert.equal(lib.conventionalSubject('feat: add dashboard'), true);
  assert.equal(lib.conventionalSubject('fix(api)!: drop field'), true);
  assert.equal(lib.conventionalSubject('Add dashboard'), false);
});

test('parseStatusV2 reconstructs the upstream track string', () => {
  const header = (extra: string): string => `# branch.oid abc1234def\n# branch.head feat\n# branch.upstream origin/feat\n${extra}`;
  assert.equal(lib.parseStatusV2(header('# branch.ab +2 -1\n')).track, '[ahead 2, behind 1]');
  assert.equal(lib.parseStatusV2(header('# branch.ab +0 -3\n')).track, '[behind 3]');
  assert.equal(lib.parseStatusV2(header('')).track, '[gone]');
  const dirty = lib.parseStatusV2('# branch.oid abc\n# branch.head main\n1 .M N... 1 1 1 a b f\n? new\n? other\n');
  assert.deepEqual([dirty.dirty, dirty.untracked, dirty.track], [1, 2, '']);
  assert.equal(lib.parseStatusV2('# branch.oid (initial)\n# branch.head main\n').branch, '-');
  assert.equal(lib.parseStatusV2('# branch.oid 1234567890\n# branch.head (detached)\n').branch, '1234567');
});

test('printFailingChecks surfaces only failing checks and the log tail', () => {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => (chunks.push(String(chunk)), true)) as typeof process.stdout.write;
  try {
    lib.printFailingChecks(work);
  } finally {
    process.stdout.write = write;
  }
  const out = chunks.join('');
  assert.match(out, /cordon \/ gate/);
  assert.match(out, /not ok 5 cordon gate/);
  assert.doesNotMatch(out, /lint/);
});

test('prBodySummary lists new, modified and removed files with the shortstat', () => {
  sh(work, 'checkout', '-q', '-b', 'feat/body', 'origin/main');
  commitFile(work, 'new.txt', 'feat: new');
  write(path.join(work, 'a.txt'), 'changed\n');
  sh(work, 'commit', '-q', '-am', 'feat: change a');
  const body = lib.prBodySummary(work, 'main');
  assert.match(body, /^## Changes\n\*\*New:\*\* `new\.txt`\n\*\*Modified:\*\* `a\.txt`\n\n_2 files changed/);
  assert.equal(readFileSync(path.join(work, 'a.txt'), 'utf8'), 'changed\n');
});
