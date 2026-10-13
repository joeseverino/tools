import { git, defaultBranch, mergedBranches, planPrune, syncClean } from '../git/index.ts';
import { readFleet } from '../git/fleet.ts';
import { blank, header, msg } from '../sdk/output.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { resyncRows } from './plan.ts';
import type { ResyncRow } from './plan.ts';

export const spec: ToolSpec = {
  name: 'resync',
  description: 'Reconcile local repos with the remote after merging PRs on GitHub.',
  group: 'Workspace',
  order: 220,
  effect: 'local_write',
  network: true,
  synopsis: ['resync [options] [name]'],
  paras: [
    "The closing beat of the workspace loop (resync → work → ship → merge → resync). For each clean repo with a remote: fetch + prune, fast-forward the default branch, and delete local branches whose upstream was merged and auto-deleted on GitHub. If you are stranded on such a branch (you merged the PR on GitHub and came back to the terminal still on it) resync steps you back onto the default branch first, then prunes it. It never deletes a branch that still has unique local commits — those are reported as 'kept (diverged)' so you can decide — and it never touches a repo with uncommitted changes. Defaults to the whole fleet; pass NAME to scope to one repo. --dry-run fetches (harmless) and reports the plan without changing any local branch or working tree.",
  ],
  options: [
    { flags: ['-n', '--dry-run'], help: 'Show what would be reconciled; change nothing local' },
    {
      flags: ['--reap'],
      help: 'Also delete local branches whose PR has merged but whose remote was not auto-deleted (one gh lookup per branch; never touches base, the current branch, or unmerged work)',
    },
  ],
  positionals: [{ name: 'name', help: 'Only repos whose name contains NAME' }],
};

function joinParts(parts: string[]): string {
  return parts.join(' · ');
}

function count(cwd: string, args: string[], fallback: number): number {
  const result = git(cwd, args);
  const parsed = Number.parseInt(result.stdout.trim(), 10);
  return result.ok && Number.isFinite(parsed) ? parsed : fallback;
}

/** What a dry run would do in one repo; null when the fetch fails. */
export function previewRepo(cwd: string, reap: boolean): string | null {
  const base = defaultBranch(cwd);
  if (!git(cwd, ['fetch', '-q', 'origin', '--prune']).ok) return null;
  const { drop, keep } = planPrune(cwd, base);
  const behind = count(cwd, ['rev-list', '--count', `${base}..origin/${base}`], 0);
  const parts: string[] = [];
  if (behind !== 0) parts.push(`ff ${base} ↓${behind}`);
  if (drop.length) parts.push(`would drop: ${drop.join(',')}`);
  if (keep.length) parts.push(`would keep (diverged): ${keep.join(',')}`);
  if (reap) {
    const reapable = mergedBranches(cwd, base);
    if (reapable.length) parts.push(`would reap (merged): ${reapable.join(',')}`);
  }
  return parts.length ? joinParts(parts) : 'already clean';
}

function headOrDash(cwd: string): string {
  const result = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return result.ok && result.stdout.trim() ? result.stdout.trim() : '-';
}

function branchCount(cwd: string): number {
  return git(cwd, ['for-each-ref', 'refs/heads']).stdout.split('\n').filter(Boolean).length;
}

function revParse(cwd: string, ref: string): string {
  const result = git(cwd, ['rev-parse', '-q', '--verify', ref]);
  return result.ok ? result.stdout.trim() : '';
}

function goneKept(cwd: string, base: string): string[] {
  return git(cwd, ['for-each-ref', '--format=%(refname:short) %(upstream:track)', 'refs/heads'])
    .stdout.split('\n')
    .filter((line) => line.includes('[gone]'))
    .map((line) => line.split(' ')[0] ?? '')
    .filter((name) => name && name !== base);
}

/** Reconciles one repo and describes what changed; null when the fetch fails. */
export function applyRepo(cwd: string, reap: boolean): { text: string; changed: boolean } | null {
  const base = defaultBranch(cwd);
  const beforeBranch = headOrDash(cwd);
  const beforeBase = revParse(cwd, base);
  const beforeCount = branchCount(cwd);

  if (!syncClean(cwd, base)) return null;

  const afterBranch = headOrDash(cwd);
  const afterBase = revParse(cwd, base);
  const dropped = beforeCount - branchCount(cwd);

  const parts: string[] = [];
  if (beforeBranch !== afterBranch) parts.push(`${beforeBranch} → ${afterBranch}`);
  if (beforeBase && beforeBase !== afterBase) parts.push(`ff ${base}`);
  if (dropped > 0) parts.push(`dropped ${dropped}`);
  const kept = goneKept(cwd, base);
  if (kept.length) parts.push(`kept (diverged): ${kept.join(',')}`);

  if (reap) {
    const reaped: string[] = [];
    for (const branch of mergedBranches(cwd, base)) {
      if (git(cwd, ['branch', '-qD', branch]).ok) reaped.push(branch);
    }
    if (reaped.length) parts.push(`reaped: ${reaped.join(',')}`);
  }
  return { text: joinParts(parts), changed: parts.length > 0 };
}

export function reconcileRepo(row: ResyncRow, dry: boolean, reap: boolean): void {
  if (dry) {
    const preview = previewRepo(row.path, reap);
    if (preview === null) msg('red', row.name, 'fetch failed');
    else msg('dim', row.name, preview);
    return;
  }
  const applied = applyRepo(row.path, reap);
  if (applied === null) msg('red', row.name, 'fetch failed');
  else if (applied.changed) msg('green', row.name, applied.text);
  else msg('dim', row.name, 'already in sync');
}

const run: Handler = (args, rt) => {
  let dry = false;
  let reap = false;
  let name = '';
  for (const arg of args) {
    if (arg === '-n' || arg === '--dry-run') dry = true;
    else if (arg === '--reap') reap = true;
    else if (arg.startsWith('-')) rt.dieUnknown('option', arg);
    else name = arg;
  }

  const rows = resyncRows(readFleet(name ? [name] : []));

  header('resync', rows.length);
  if (dry) msg('yellow', 'preview', 'dry run — nothing local will change');
  blank();

  if (rows.length === 0) {
    msg('dim', 'none', 'no git repos with a remote matched');
    blank();
    return 0;
  }

  let checked = 0;
  let dirtyLeft = 0;
  for (const row of rows) {
    if (row.dirty > 0) {
      msg('yellow', row.name, `±${row.dirty} uncommitted — left alone`);
      dirtyLeft += 1;
      continue;
    }
    reconcileRepo(row, dry, reap);
    checked += 1;
  }

  blank();
  msg('dim', 'summary', `${checked} reconciled · ${dirtyLeft} left dirty`);
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };
