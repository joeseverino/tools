// The one owner of git and PR mechanics: branch safety, commit, push, PR open
// and merge, and post-merge cleanup. Every function takes the repo directory
// explicitly. GitHub calls go through GH_BIN so tests can shadow gh.
import { spawnSync } from 'node:child_process';
import { msgLine, palette } from '../sdk/output.ts';
import { run } from '../sdk/process.ts';
import type { RunResult } from '../sdk/process.ts';

export const TARGET_OK = 0;
export const TARGET_FAIL = 1;
export const TARGET_STALE = 3;

export type BranchState = 'trunk' | 'zombie' | 'pr' | 'current' | 'stale';

export function ghBin(): string {
  return process.env['GH_BIN'] || 'gh';
}

export function git(cwd: string, args: readonly string[]): RunResult {
  return run('git', [...args], { cwd });
}

function gh(cwd: string, args: readonly string[]): RunResult {
  return run(ghBin(), [...args], { cwd });
}

function ok(cwd: string, args: readonly string[]): boolean {
  return git(cwd, args).ok;
}

/** Runs git with the terminal attached, for commands whose own output the user should see. */
function gitInherit(cwd: string, args: readonly string[]): number {
  return spawnSync('git', [...args], { cwd, stdio: 'inherit' }).status ?? 1;
}

function gitSilent(cwd: string, args: readonly string[]): boolean {
  return git(cwd, args).ok;
}

function count(cwd: string, args: readonly string[], fallback: number): number {
  const result = git(cwd, args);
  const parsed = Number.parseInt(result.stdout.trim(), 10);
  return result.ok && Number.isFinite(parsed) ? parsed : fallback;
}

/** Short name of the checked-out branch, or "HEAD" when detached or unborn. */
export function currentBranch(cwd: string): string {
  const result = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return result.ok && result.stdout.trim() ? result.stdout.trim() : 'HEAD';
}

function currentBranchOrEmpty(cwd: string): string {
  const result = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return result.ok ? result.stdout.trim() : '';
}

export function defaultBranch(cwd: string): string {
  const result = git(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  const name = result.ok ? result.stdout.trim().replace(/^refs\/remotes\/origin\//, '') : '';
  return name || 'main';
}

export function uniqueCommits(cwd: string, base: string): number {
  return count(cwd, ['rev-list', '--count', `origin/${base}..HEAD`], 0);
}

export function behindCommits(cwd: string, base: string): number {
  return count(cwd, ['rev-list', '--count', `HEAD..origin/${base}`], 0);
}

/** True when anything differs: unstaged, staged, or a new untracked file that is not ignored. */
export function worktreeDirty(cwd: string): boolean {
  return !ok(cwd, ['diff', '--quiet']) || !ok(cwd, ['diff', '--cached', '--quiet']) || git(cwd, ['ls-files', '--others', '--exclude-standard']).stdout.trim() !== '';
}

export interface RepoSnapshot {
  branch: string;
  upstreamName: string;
  upstream: boolean;
  ahead: number;
  behind: number;
  gone: boolean;
  track: string;
  dirty: number;
  untracked: number;
}

/** A repo's whole git state from one `git status --porcelain=v2 --branch`. */
export function parseStatusV2(output: string): RepoSnapshot {
  let oid = '';
  let branch = '-';
  let upstreamName = '';
  let upstream = false;
  let ahead = 0;
  let behind = 0;
  let sawAheadBehind = false;
  let dirty = 0;
  let untracked = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length);
    else if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length);
    else if (line.startsWith('# branch.upstream ')) {
      upstreamName = line.slice('# branch.upstream '.length);
      upstream = true;
    } else if (line.startsWith('# branch.ab ')) {
      sawAheadBehind = true;
      upstream = true;
      const [plus = '', minus = ''] = line.slice('# branch.ab '.length).split(' ');
      ahead = Number.parseInt(plus.replace(/^\+/, ''), 10) || 0;
      behind = Number.parseInt(minus.replace(/^-/, ''), 10) || 0;
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) dirty += 1;
    else if (line.startsWith('? ')) untracked += 1;
  }
  if (oid === '(initial)') branch = '-';
  if (branch === '(detached)') branch = oid.slice(0, 7);
  let gone = false;
  let track = '';
  if (upstream && !sawAheadBehind) {
    gone = true;
    track = '[gone]';
  } else if (ahead > 0 && behind > 0) track = `[ahead ${ahead}, behind ${behind}]`;
  else if (ahead > 0) track = `[ahead ${ahead}]`;
  else if (behind > 0) track = `[behind ${behind}]`;
  return { branch, upstreamName, upstream, ahead, behind, gone, track, dirty, untracked };
}

export function repoSnapshot(cwd: string): RepoSnapshot {
  return parseStatusV2(git(cwd, ['status', '--porcelain=v2', '--branch']).stdout);
}

export function branchHasOpenPr(cwd: string, branch: string, base: string): boolean {
  const result = gh(cwd, ['pr', 'list', '--head', branch, '--base', base, '--state', 'open', '--json', 'number', '-q', '.[0].number']);
  return result.ok && result.stdout.trim() !== '';
}

/** True when branch has a merged PR: the squash-merge signal ancestry cannot see. */
export function branchPrMerged(cwd: string, branch: string): boolean {
  const result = gh(cwd, ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number', '-q', '.[0].number']);
  return result.ok && result.stdout.trim() !== '';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function freshName(prefix = 'ship', now = new Date()): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}/${date}-${clock}`;
}

function stashCarry(cwd: string, label: string): boolean {
  return worktreeDirty(cwd) && gitSilent(cwd, ['stash', 'push', '-q', '-u', '-m', label]);
}

function stashRestore(cwd: string): void {
  gitSilent(cwd, ['stash', 'pop', '-q']);
}

/** Cuts branch off origin/base, carrying uncommitted work. Returns the branch name, or null on failure. */
export function cutFresh(cwd: string, base: string, branch: string): string | null {
  const stashed = stashCarry(cwd, `carry work onto ${branch}`);
  if (!gitSilent(cwd, ['checkout', '-q', '-b', branch, `origin/${base}`])) {
    if (stashed) stashRestore(cwd);
    return null;
  }
  if (stashed) stashRestore(cwd);
  return branch;
}

/** The one ladder that decides whether a branch is a safe home for new work. */
export function branchState(cwd: string, base: string, wantPr = true): BranchState {
  const cur = currentBranch(cwd);
  if (cur === 'main' || cur === 'master' || cur === 'HEAD') return 'trunk';
  if (uniqueCommits(cwd, base) === 0) {
    if (worktreeDirty(cwd) && behindCommits(cwd, base) === 0) return 'current';
    return 'zombie';
  }
  if (wantPr && branchHasOpenPr(cwd, cur, base)) return 'pr';
  if (behindCommits(cwd, base) === 0) return 'current';
  return 'stale';
}

export interface TargetBranch {
  code: number;
  branch: string;
}

/** Resolves the branch to work on; a stale branch is reported, never silently recut. */
export function targetBranch(cwd: string, base: string, prefix = 'ship'): TargetBranch {
  switch (branchState(cwd, base)) {
    case 'trunk':
    case 'zombie': {
      const branch = cutFresh(cwd, base, freshName(prefix));
      return branch === null ? { code: TARGET_FAIL, branch: '' } : { code: TARGET_OK, branch };
    }
    case 'pr':
    case 'current':
      return { code: TARGET_OK, branch: currentBranch(cwd) };
    case 'stale':
      return { code: TARGET_STALE, branch: '' };
  }
}

/** Replays the current branch's commits onto a fresh branch off origin/base; null when one conflicts. */
export function rebranch(cwd: string, base: string, prefix = 'ship'): string | null {
  const cur = currentBranch(cwd);
  const fork = git(cwd, ['merge-base', cur, `origin/${base}`]);
  const forkPoint = fork.ok ? fork.stdout.trim() : '';
  if (!forkPoint) return null;
  const fresh = freshName(prefix);
  const stashed = stashCarry(cwd, `ship: carry work onto ${fresh}`);
  if (!gitSilent(cwd, ['checkout', '-q', '-b', fresh, `origin/${base}`])) {
    if (stashed) stashRestore(cwd);
    return null;
  }
  if (gitSilent(cwd, ['cherry-pick', '--empty=drop', `${forkPoint}..${cur}`])) {
    if (stashed) stashRestore(cwd);
    return fresh;
  }
  gitSilent(cwd, ['cherry-pick', '--abort']);
  gitSilent(cwd, ['checkout', '-q', cur]);
  gitSilent(cwd, ['branch', '-qD', fresh]);
  if (stashed) stashRestore(cwd);
  return null;
}

/** A default commit subject from the staged top-level paths. */
export function commitMessage(cwd: string): string {
  const names = git(cwd, ['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean);
  const dirs = [...new Set(names.map((name) => name.split('/')[0] ?? ''))].sort().slice(0, 4);
  return `chore: update ${dirs.join(',') || 'working tree'}`;
}

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s.+/;

export function conventionalSubject(subject: string): boolean {
  return CONVENTIONAL.test(subject);
}

const ICLOUD_CONFLICT = /^.+ [0-9]+(\..+)?$/;

/** Staged files named like an iCloud duplicate ("<stem> <n>.<ext>"). */
export function stagedIcloudConflicts(cwd: string): string[] {
  return git(cwd, ['diff', '--cached', '--name-only', '-z'])
    .stdout.split('\0')
    .filter((file) => file !== '' && ICLOUD_CONFLICT.test(file.slice(file.lastIndexOf('/') + 1)));
}

/** Unstages iCloud-conflict duplicates and warns on stderr; they are sync junk, not work. */
export function dropIcloudConflicts(cwd: string): void {
  const files = stagedIcloudConflicts(cwd);
  if (files.length === 0) return;
  if (!ok(cwd, ['restore', '--staged', '--', ...files])) gitSilent(cwd, ['reset', '-q', 'HEAD', '--', ...files]);
  process.stderr.write(`${msgLine('yellow', 'icloud', `excluded ${files.length} conflict file(s) — re-add a real one with: git add <file>`)}\n`);
  for (const file of files) process.stderr.write(`${msgLine('dim', '', file)}\n`);
}

/** Stages (the given paths, else everything) and commits. Returns 1 when there is nothing to commit. */
export function commit(cwd: string, message: string, paths: readonly string[] = []): number {
  const staged = paths.length ? gitInherit(cwd, ['add', '--', ...paths]) : gitInherit(cwd, ['add', '-A']);
  if (staged !== 0) return staged;
  dropIcloudConflicts(cwd);
  if (ok(cwd, ['diff', '--cached', '--quiet'])) return 1;
  return gitInherit(cwd, ['commit', '-q', '-m', message || commitMessage(cwd)]);
}

/** Prints the failing CI checks of the current branch's PR, then the failed-step log tail. */
export function printFailingChecks(cwd: string): void {
  const p = palette();
  for (const row of gh(cwd, ['pr', 'checks']).stdout.split('\n')) {
    const [name = '', state = '', , url = ''] = row.split('\t');
    if (state === 'fail' && name) process.stdout.write(`  ${p.RED}${'fail'.padEnd(10)}${p.RESET} ${name}  ${p.DIM}${url}${p.RESET}\n`);
  }
  const log = gh(cwd, ['run', 'view', '--log-failed']).stdout.replace(/\n+$/, '').split('\n').slice(-20).join('\n');
  if (log) process.stdout.write(`${log.split('\n').map((line) => `    ${line}`).join('\n')}\n`);
}

export function pushCurrent(cwd: string, quiet = false): boolean {
  if (quiet) return git(cwd, ['push', '-q', '-u', 'origin', 'HEAD']).ok;
  return gitInherit(cwd, ['push', '-q', '-u', 'origin', 'HEAD']) === 0;
}

export function pullPush(cwd: string): boolean {
  return gitInherit(cwd, ['pull', '-q', '--rebase']) === 0 && gitInherit(cwd, ['push', '-q']) === 0;
}

function nameStatusList(lines: readonly string[], letter: string): string {
  return lines
    .filter((line) => line.startsWith(letter))
    .map((line) => `\`${line.trim().split(/[ \t]+/)[1] ?? ''}\``)
    .join(',');
}

/** Markdown PR body: new, modified and removed files plus the shortstat against origin/base. */
export function prBodySummary(cwd: string, base: string): string {
  const lines = git(cwd, ['diff', '--name-status', `origin/${base}...HEAD`]).stdout.split('\n');
  const stat = git(cwd, ['diff', '--shortstat', `origin/${base}...HEAD`]).stdout.replace(/^ */, '').split('\n')[0] ?? '';
  const parts = ['## Changes'];
  const added = nameStatusList(lines, 'A');
  const modified = nameStatusList(lines, 'M');
  const removed = nameStatusList(lines, 'D');
  if (added) parts.push(`**New:** ${added}`);
  if (modified) parts.push(`**Modified:** ${modified}`);
  if (removed) parts.push(`**Removed:** ${removed}`);
  if (stat) parts.push('', `_${stat}_`);
  return parts.join('\n');
}

/** Opens a PR for the current branch or syncs the existing one; returns its URL ('' when creation failed). */
export function openOrUpdatePr(cwd: string, base: string, title = '', body = '', updateBody = false): string | null {
  const head = currentBranchOrEmpty(cwd);
  const listed = gh(cwd, ['pr', 'list', '--head', head, '--base', base, '--json', 'url', '-q', '.[0].url']);
  const url = listed.ok ? listed.stdout.trim() : '';
  if (url) {
    const args: string[] = [];
    if (title) args.push('--title', title);
    if (updateBody && body) args.push('--body', body);
    if (args.length) gh(cwd, ['pr', 'edit', url, ...args]);
    return url;
  }
  const created = title ? gh(cwd, ['pr', 'create', '--base', base, '--title', title, '--body', body]) : gh(cwd, ['pr', 'create', '--base', base, '--fill']);
  if (!created.ok) return null;
  const view = gh(cwd, ['pr', 'view', '--json', 'url', '-q', '.url']);
  return view.ok ? view.stdout.trim() : '';
}

export type MergeStrategy = '--squash' | '--merge' | '--rebase';

/** The single merge mechanic: merge the current branch's PR and delete its remote branch. */
export function mergePr(cwd: string, strategy: MergeStrategy = '--squash', admin = false): RunResult {
  return gh(cwd, ['pr', 'merge', strategy, '--delete-branch', ...(admin ? ['--admin'] : [])]);
}

/** Squash-merges the current PR once its checks are green. Returns 2 when they are not, 1 on merge failure. */
export function land(cwd: string): number {
  if (!gh(cwd, ['pr', 'checks']).ok) return 2;
  return mergePr(cwd, '--squash', false).ok ? 0 : 1;
}

export function branchGone(cwd: string, branch: string): boolean {
  return git(cwd, ['for-each-ref', '--format=%(upstream:track)', `refs/heads/${branch}`]).stdout.includes('[gone]');
}

function goneBranches(cwd: string): string[] {
  return git(cwd, ['for-each-ref', '--format=%(refname:short) %(upstream:track)', 'refs/heads'])
    .stdout.split('\n')
    .filter((line) => line.includes('[gone]'))
    .map((line) => line.split(' ')[0] ?? '')
    .filter(Boolean);
}

/** [gone] branches (excluding base) split into those safe to drop and those with real unmerged work. */
export function planPrune(cwd: string, base: string): { drop: string[]; keep: string[] } {
  const drop: string[] = [];
  const keep: string[] = [];
  for (const branch of goneBranches(cwd)) {
    if (branch === base) continue;
    const unique = count(cwd, ['rev-list', '--count', `origin/${base}..${branch}`], 1);
    if (unique === 0 || branchPrMerged(cwd, branch)) drop.push(branch);
    else keep.push(branch);
  }
  return { drop, keep };
}

/** Fetch --prune, fast-forward base, and drop merged-and-gone branches. False only when the fetch fails. */
export function syncClean(cwd: string, baseArg = ''): boolean {
  const base = baseArg || defaultBranch(cwd);
  if (gitInherit(cwd, ['fetch', '-q', 'origin', '--prune']) !== 0) return false;
  let cur = currentBranchOrEmpty(cwd);

  if (cur && cur !== base && branchGone(cwd, cur) && (uniqueCommits(cwd, base) === 0 || branchPrMerged(cwd, cur))) {
    if (gitSilent(cwd, ['checkout', '-q', base])) cur = base;
  }
  if (cur === base) gitSilent(cwd, ['merge', '-q', '--ff-only', `origin/${base}`]);

  for (const branch of goneBranches(cwd)) {
    if (branch === base) continue;
    const unique = count(cwd, ['rev-list', '--count', `origin/${base}..${branch}`], 1);
    if (unique !== 0 && !branchPrMerged(cwd, branch)) continue;
    gitSilent(cwd, ['branch', '-q', '-D', branch]);
  }
  return true;
}

/** Local branches whose PR merged on GitHub, minus base, the current branch and anything with unpushed commits. */
export function mergedBranches(cwd: string, baseArg = ''): string[] {
  const base = baseArg || defaultBranch(cwd);
  const cur = currentBranchOrEmpty(cwd);
  const merged: string[] = [];
  for (const branch of git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout.split('\n')) {
    if (!branch || branch === base || branch === cur) continue;
    if (!branchPrMerged(cwd, branch)) continue;
    if (count(cwd, ['rev-list', '--count', `${branch}@{upstream}..${branch}`], 0) === 0) merged.push(branch);
  }
  return merged;
}
