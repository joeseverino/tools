import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseEntry, rsyncPlan } from '../../lib/backup/main.ts';
import { parseAdd, parseRead } from '../../lib/backlog/main.ts';
import { renderTaskList } from '../../lib/backlog/render.ts';
import { figureArgs, firstKitTokens } from '../../lib/brand/main.ts';
import { dropIndexLines, encodeClaudePath, memoryFileText, normalizeSlug, upsertIndex } from '../../lib/remember/main.ts';
import { svmc, svmcAvailable, svmcBin } from '../../lib/sdk/svmc.ts';
import { activityInput } from '../../lib/vault/main.ts';
import { syncFreshness } from '../../lib/hq/state.ts';
import { inboxCount } from '../../lib/vault/state.ts';

function temp(): string {
  return mkdtempSync(path.join(tmpdir(), 'ported-'));
}

function fakeBin(dir: string, body: string): string {
  const file = path.join(dir, 'fake-mcp');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('remember: slugs drop type prefixes in sequence and underscore dashes', () => {
  assert.equal(normalizeSlug('feedback_use-rg-and-fd'), 'use_rg_and_fd');
  assert.equal(normalizeSlug('user_feedback_x'), 'x');
  assert.equal(normalizeSlug('plain-slug'), 'plain_slug');
});

test('remember: Claude project paths fold slash, dot and space to dashes', () => {
  assert.equal(encodeClaudePath('/a/b c.d', '/home/u'), '/home/u/.claude/projects/-a-b-c-d/memory');
});

test('remember: memory files quote and escape the description', () => {
  assert.equal(
    memoryFileText('feedback-x', 'feedback', 'say "hi"', 'body'),
    '---\nname: feedback-x\ndescription: "say \\"hi\\""\nmetadata:\n  type: feedback\n---\n\nbody\n',
  );
});

test('remember: a backslash in the description is escaped before the quotes', () => {
  assert.equal(
    memoryFileText('feedback-x', 'feedback', 'a\\b "c"', 'body'),
    '---\nname: feedback-x\ndescription: "a\\\\b \\"c\\""\nmetadata:\n  type: feedback\n---\n\nbody\n',
  );
});

test('remember: the index upserts one line per file and drops forgotten ones', () => {
  const first = upsertIndex('', 'a.md', '- [A](a.md) — one');
  assert.equal(first, '- [A](a.md) — one\n');
  const second = upsertIndex(first, 'b.md', '- [B](b.md) — two');
  assert.equal(upsertIndex(second, 'a.md', '- [A2](a.md) — three'), '- [B](b.md) — two\n- [A2](a.md) — three\n');
  assert.equal(dropIndexLines(second, 'a.md'), '- [B](b.md) — two\n');
  assert.equal(dropIndexLines('- [A](a.md) — one\n', 'a.md'), '');
  assert.equal(upsertIndex('\n\n', 'a.md', '- x'), '- x\n');
});

test('backup: entries split at the first tab and need both halves', () => {
  assert.deepEqual(parseEntry('/src/a\tdest/a'), { source: '/src/a', destination: 'dest/a' });
  assert.deepEqual(parseEntry('/src/a b\tdest/x\ty'), { source: '/src/a b', destination: 'dest/x\ty' });
  assert.equal(parseEntry('no tab'), null);
  assert.equal(parseEntry('/src\t'), null);
});

test('backup: directories mirror with --delete, files copy to the exact path', () => {
  assert.deepEqual(rsyncPlan('/s/d', '/b/d', true), { args: ['-a', '--delete', '/s/d/', '/b/d/'], destDir: '/b/d' });
  assert.deepEqual(rsyncPlan('/s/f', '/b/x/f', false), { args: ['-a', '/s/f', '/b/x/f'], destDir: '/b/x' });
});

test('backlog: add collects flags, repeats related projects, and keeps words after --', () => {
  const never = (flag: string): never => {
    throw new Error(`unexpected ${flag}`);
  };
  assert.deepEqual(parseAdd(['Fix', 'it', '--project', 'tools', '--related-projects', 'a', 'b', '--', 'more'], never), {
    flags: ['--project', 'tools', '--related-projects', 'a', '--related-projects', 'b'],
    title: ['Fix', 'it', 'more'],
  });
  assert.throws(() => parseAdd(['--bogus'], never), /unexpected --bogus/);
});

test('backlog: read flags map onto task-list flags', () => {
  const never = (_kind: 'flag' | 'argument', token: string): never => {
    throw new Error(`unexpected ${token}`);
  };
  assert.deepEqual(parseRead('stale', ['--days', '7', '--json'], never), { json: true, flags: ['--stale-only', '--stale-days', '7'] });
  assert.deepEqual(parseRead('board', ['--status', 'active', '--project', 'p', '--all', '--stale'], never).flags, [
    '--status', 'active', '--project', 'p', '--all', '--stale-only',
  ]);
  assert.throws(() => parseRead('list', ['x'], never), /unexpected x/);
});

test('backlog: the board groups by project with cross last, and an error envelope exits 1', () => {
  const task = (project: string, slug: string): Record<string, unknown> => ({ project, status: 'open', slug, title: slug });
  const board = renderTaskList('board', { ok: true, stale_days: 14, tasks: [task('cross', 'c'), task('zeta', 'z'), task('alpha', 'a')] });
  assert.equal(board.code, 0);
  const order = ['alpha (1)', 'zeta (1)', 'cross (1)'].map((label) => board.text.indexOf(label));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.match(renderTaskList('list', { ok: true, tasks: [] }).text, /backlog 0 tasks/);
  const failed = renderTaskList('board', { ok: false, error: 'boom' });
  assert.equal(failed.code, 1);
  assert.match(failed.text, /error {6}boom/);
});

test('brand: figure uses the primary kit tokens unless --tokens is passed', () => {
  const dir = temp();
  const tokens = path.join(dir, 't.css');
  writeFileSync(tokens, '');
  assert.deepEqual(figureArgs('s.json', ['--out', 'o'], tokens), ['figure', 's.json', '--tokens', tokens, '--out', 'o']);
  assert.deepEqual(figureArgs('s.json', ['--tokens', 'mine'], tokens), ['figure', 's.json', '--tokens', 'mine']);
  assert.deepEqual(figureArgs('s.json', [], path.join(dir, 'missing.css')), ['figure', 's.json']);
});

test('brand: the fallback tokens file is the first by path, two or three levels deep', () => {
  const kits = path.join(temp(), 'kits');
  for (const rel of ['zeta/tokens.css', 'alpha/web/tokens.css', 'alpha/deep/er/tokens.css']) {
    mkdirSync(path.join(kits, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(kits, rel), '');
  }
  assert.equal(firstKitTokens(kits), path.join(kits, 'alpha/web/tokens.css'));
  assert.equal(firstKitTokens(path.join(kits, 'none')), '');
});

test('vault: the daily activity document wraps the day, repos and board', () => {
  assert.equal(activityInput('2026-01-01', '{"repos":[]}', '{"tasks":[]}'), '{"date":"2026-01-01","repos":{"repos":[]},"board":{"tasks":[]}}');
});

test('vault: inbox count ignores non-markdown files and missing directories', () => {
  const dir = temp();
  writeFileSync(path.join(dir, 'a.md'), '');
  writeFileSync(path.join(dir, 'b.txt'), '');
  mkdirSync(path.join(dir, 'c.md'));
  assert.equal(inboxCount(dir), 1);
  assert.equal(inboxCount(path.join(dir, 'nope')), 0);
});

test('svmc: SVMC_BIN names the binary and the vault pin prefers SVMC_VAULT_PATH over NOTES_HOME', () => {
  const dir = temp();
  const bin = fakeBin(dir, 'echo "$SVMC_VAULT_PATH|$*"; cat');
  withEnv({ SVMC_BIN: bin, SVMC_VAULT_PATH: undefined, NOTES_HOME: '/notes' }, () => {
    assert.equal(svmcBin(), bin);
    assert.equal(svmcAvailable(), true);
    assert.equal(svmc(['task-list'], { input: 'in' }).stdout, '/notes|task-list\nin');
  });
  withEnv({ SVMC_BIN: bin, SVMC_VAULT_PATH: '/explicit', NOTES_HOME: '/notes' }, () => {
    assert.match(svmc(['x']).stdout, /^\/explicit\|x/);
    assert.match(svmc(['x'], { vaultPath: '/named' }).stdout, /^\/named\|x/);
  });
  withEnv({ SVMC_BIN: path.join(dir, 'absent') }, () => assert.equal(svmcAvailable(), false));
});

test('vault: hq freshness is never, skip, fresh or stale from the recorded manifest hash', async () => {
  const { createHash } = await import('node:crypto');
  const dir = temp();
  const vault = path.join(dir, 'vault');
  const state = path.join(dir, 'state');
  mkdirSync(path.join(state, 'severino-tools'), { recursive: true });
  const bin = fakeBin(dir, 'echo manifest-body');
  const file = path.join(state, 'severino-tools/hq-sync.json');
  const record = (sha: string, vaultPath: string): string =>
    JSON.stringify({ manifest_sha256: sha, vault_dirs: 'a,b', synced_at: '2026-02-03T10:00:00Z', vault: vaultPath });
  withEnv({ XDG_STATE_HOME: state, SVMC_BIN: bin, NOTES_HOME: vault, SVMC_VAULT_PATH: undefined }, () => {
    assert.deepEqual(syncFreshness(vault), { kind: 'never' });
    const good = createHash('sha256').update('manifest-body\n').digest('hex');
    writeFileSync(file, record(good, vault));
    assert.deepEqual(syncFreshness(vault), { kind: 'fresh', date: '2026-02-03' });
    writeFileSync(file, record('different', vault));
    assert.deepEqual(syncFreshness(vault), { kind: 'stale', date: '2026-02-03' });
    writeFileSync(file, record(good, '/other'));
    assert.deepEqual(syncFreshness(vault), { kind: 'skip' });
    writeFileSync(file, 'not json');
    assert.deepEqual(syncFreshness(vault), { kind: 'skip' });
  });
});
