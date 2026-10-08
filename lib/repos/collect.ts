// Per-directory fleet scan: one repo's git state, package manager and CI facts.
// Runs synchronously so a worker thread can own one repo at a time.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { branchState, defaultBranch, git, repoSnapshot } from '../git/index.ts';
import { isRecord, isStringArray } from '../sdk/guards.ts';
import { run } from '../sdk/process.ts';
import type { ParsedRecord } from './record.ts';

export interface CollectOptions {
  fetch: boolean;
  sizes: boolean;
  icloud: boolean;
  pm: string;
  dirty: boolean;
  unpushed: boolean;
  localOk: readonly string[];
}

export interface CollectJob {
  dir: string;
  name: string;
  root: string;
  options: CollectOptions;
}

export function isCollectJob(value: unknown): value is CollectJob {
  if (!isRecord(value) || !isRecord(value['options'])) return false;
  const o = value['options'];
  return (
    typeof value['dir'] === 'string' && typeof value['name'] === 'string' && typeof value['root'] === 'string' &&
    typeof o['fetch'] === 'boolean' && typeof o['sizes'] === 'boolean' && typeof o['icloud'] === 'boolean' &&
    typeof o['pm'] === 'string' && typeof o['dirty'] === 'boolean' && typeof o['unpushed'] === 'boolean' &&
    isStringArray(o['localOk'])
  );
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function isDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function visibleEntries(dir: string): string[] {
  try {
    return readdirSync(dir).filter((entry) => !entry.startsWith('.'));
  } catch {
    return [];
  }
}

export function detectPm(dir: string): string {
  const has = (name: string): boolean => isFile(path.join(dir, name));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('package-lock.json')) return 'npm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  if (has('package.json')) return 'none';
  return '-';
}

export function detectLang(dir: string): string {
  const has = (name: string): boolean => isFile(path.join(dir, name));
  if (has('package.json')) return 'node';
  if (has('pyproject.toml') || has('requirements.txt')) return 'python';
  if (has('go.mod')) return 'go';
  if (has('Cargo.toml')) return 'rust';
  if (visibleEntries(path.join(dir, 'bin')).length > 0 || visibleEntries(dir).some((entry) => entry.endsWith('.sh'))) return 'bash';
  return 'other';
}

/** The packageManager field of package.json ("npm@11.0.0"), or '-'. */
export function packageManagerField(manifest: string): string {
  const match = /"packageManager"[ \t]*:[ \t]*"([^"\n]+)"/.exec(manifest);
  return match?.[1] || '-';
}

function nvmrcVersion(dir: string): string {
  const file = path.join(dir, '.nvmrc');
  if (!isFile(file)) return '-';
  try {
    return (readFileSync(file, 'utf8').split('\n')[0] ?? '').replace(/\s/g, '') || '-';
  } catch {
    return '-';
  }
}

function workflowCount(dir: string): number {
  try {
    return readdirSync(path.join(dir, '.github', 'workflows'), { withFileTypes: true }).filter(
      (entry) => entry.isFile() && /\.ya?ml$/.test(entry.name),
    ).length;
  } catch {
    return 0;
  }
}

const ICLOUD_DUP = /^.* [0-9]\..*$/s;

/** Regular files named like an iCloud duplicate ("name 2.ext"), skipping node_modules and .git. */
export function icloudDuplicates(dir: string): number {
  let found = 0;
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') walk(path.join(current, entry.name));
      } else if (entry.isFile() && ICLOUD_DUP.test(entry.name)) found += 1;
    }
  };
  walk(dir);
  return found;
}

function nodeModulesSize(dir: string): string {
  const result = run('du', ['-sh', path.join(dir, 'node_modules')]);
  return result.stdout.split('\t')[0] ?? '';
}

export function needsFlags(rec: Pick<ParsedRecord, 'dirty' | 'untracked' | 'ahead' | 'behind' | 'upstream' | 'upstream_gone' | 'has_remote' | 'local_ok'>): Pick<ParsedRecord, 'needs_ship' | 'needs_resync' | 'needs_attention'> {
  const needsShip = rec.dirty + rec.untracked > 0 || rec.ahead > 0 || (rec.has_remote && !rec.upstream && !rec.local_ok);
  const needsResync = rec.upstream_gone || rec.behind > 0;
  return { needs_ship: needsShip, needs_resync: needsResync, needs_attention: needsShip || needsResync || (!rec.has_remote && !rec.local_ok) };
}

/** One repo's record, or null when the directory is not a repo or a filter drops it. */
export function collectRepo(job: CollectJob): ParsedRecord | null {
  const { dir, options } = job;
  const isGit = git(dir, ['rev-parse', '--is-inside-work-tree']).ok;
  const hasManifest = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'].some((file) => isFile(path.join(dir, file)));
  if (!isGit && !hasManifest) return null;

  let branch = '-';
  let remote = '';
  let dirty = 0;
  let untracked = 0;
  let ahead = 0;
  let behind = 0;
  let upstream = false;
  let upstreamName = '';
  let upstreamTrack = '';
  let upstreamGone = false;
  let sha = '';
  let date = '';
  let subject = '';
  let stash = 0;
  let state = '-';

  if (isGit) {
    if (options.fetch) git(dir, ['fetch', '-q', 'origin', '--prune']);
    const remoteResult = git(dir, ['remote', 'get-url', 'origin']);
    remote = remoteResult.ok ? remoteResult.stdout.replace(/\n+$/, '') : '';
    const snap = repoSnapshot(dir);
    ({ branch, upstreamName, upstream, ahead, behind, dirty, untracked } = snap);
    upstreamTrack = snap.track;
    upstreamGone = snap.gone;
    const last = git(dir, ['log', '-1', '--format=%h%x1f%cs%x1f%s']);
    if (last.ok && last.stdout.trim()) [sha = '', date = '', subject = ''] = last.stdout.replace(/\n+$/, '').split('\x1f');
    stash = git(dir, ['stash', 'list']).stdout.split('\n').filter(Boolean).length;
    if (remote) state = branchState(dir, defaultBranch(dir), false) || '-';
  }

  const hasRemote = remote !== '';
  const hasPackage = isFile(path.join(dir, 'package.json'));
  const hasNodeModules = isDir(path.join(dir, 'node_modules'));
  const localOk = options.localOk.some((item) => item === job.name || item === dir);
  const flags = needsFlags({ dirty, untracked, ahead, behind, upstream, upstream_gone: upstreamGone, has_remote: hasRemote, local_ok: localOk });
  const pm = detectPm(dir);

  if (options.pm && pm !== options.pm) return null;
  if (options.dirty && dirty + untracked === 0) return null;
  if (options.unpushed && !(flags.needs_ship || flags.needs_resync || (!hasRemote && !localOk))) return null;

  return {
    name: job.name,
    root: job.root,
    path: dir,
    git: isGit,
    branch,
    remote,
    has_remote: hasRemote,
    dirty,
    untracked,
    ahead,
    behind,
    upstream,
    upstream_name: upstreamName,
    upstream_track: upstreamTrack,
    upstream_gone: upstreamGone,
    sha,
    date,
    subject,
    lang: detectLang(dir),
    pm,
    package_manager: hasPackage ? packageManagerField(readManifest(dir)) : '-',
    nvmrc: nvmrcVersion(dir),
    node_modules: hasNodeModules,
    node_modules_size: options.sizes && hasNodeModules ? nodeModulesSize(dir) : null,
    ci: workflowCount(dir),
    icloud_dups: options.icloud ? icloudDuplicates(dir) : 0,
    stash,
    local_ok: localOk,
    ...flags,
    branch_state: state,
  };
}

function readManifest(dir: string): string {
  try {
    return readFileSync(path.join(dir, 'package.json'), 'utf8');
  } catch {
    return '';
  }
}
