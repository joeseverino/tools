import type { PlanRepo } from '../repos/project.ts';

export interface ResyncRow {
  name: string;
  path: string;
  dirty: number;
}

/** Git repos with a remote, with uncommitted plus untracked files counted as dirty. */
export function resyncRows(repos: readonly PlanRepo[]): ResyncRow[] {
  return repos
    .filter((repo) => repo.git && repo.has_remote)
    .map((repo) => ({ name: repo.name, path: repo.path, dirty: (repo.dirty || 0) + (repo.untracked || 0) }));
}
