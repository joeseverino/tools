import type { PlanRepo } from '../repos/project.ts';

export interface ShipRow {
  name: string;
  path: string;
  branch: string;
  uncommitted: number;
  ahead: number;
  hasRemote: boolean;
}

/**
 * Repos with something to ship: uncommitted changes or unpushed commits. With
 * includeCleanBranch, a clean pushed feature branch also qualifies so a scoped
 * `ship <name>` can open or update its PR after an earlier push.
 */
export function shipRows(repos: readonly PlanRepo[], includeCleanBranch: boolean): ShipRow[] {
  const rows: ShipRow[] = [];
  for (const repo of repos) {
    const uncommitted = (repo.dirty || 0) + (repo.untracked || 0);
    const unpushed = (repo.ahead || 0) > 0 || Boolean(repo.has_remote && !repo.upstream && !repo.local_ok);
    const branch = repo.branch || '-';
    const cleanFeatureBranch =
      includeCleanBranch && Boolean(repo.has_remote) && uncommitted === 0 && !unpushed && branch !== 'main' && branch !== 'master' && branch !== '-';
    if (uncommitted === 0 && !unpushed && !cleanFeatureBranch) continue;
    rows.push({ name: repo.name, path: repo.path, branch, uncommitted, ahead: repo.ahead || 0, hasRemote: Boolean(repo.has_remote) });
  }
  return rows;
}
