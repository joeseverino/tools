import type { PlanRepo } from '../repos/project.ts';

export interface LandRow {
  name: string;
  path: string;
  number: number | undefined;
  ci: string;
  url: string;
}

/** Repos with an open PR, with the fields land acts on. */
export function landRows(repos: readonly PlanRepo[]): LandRow[] {
  return repos
    .filter((repo) => repo.pr?.state === 'open')
    .map((repo) => ({ name: repo.name, path: repo.path, number: repo.pr?.number, ci: repo.pr?.ci ?? '', url: repo.pr?.url ?? '' }));
}

/** CI counts as green when it passed or the repo has no checks. */
export function isGreen(ci: string): boolean {
  return ci === 'passing' || ci === 'none';
}
