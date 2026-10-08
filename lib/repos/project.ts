#!/usr/bin/env node
// repos/project.ts — the one reader for a `repos --json` payload on stdin.
//
// A driver passes a row function: (repo) => an array of cells for one TSV line,
// or null/undefined to drop that repo. The stdin plumbing and the "parse repos
// --json, fall back to empty on garbage" guard live here once, so ship / land /
// resync each declare only their own filter and columns — never a second copy of
// the read loop. The read-side sibling of lib/git.sh owning the write mechanics:
// `repos` is the one read owner, and this is the one way to consume it.

import { text } from 'node:stream/consumers';
import { isRecord, parseJson } from '../sdk/guards.ts';
import type { Pr } from './pr.ts';
import type { Repo } from './record.ts';

export type PlanRepo = Pick<Repo, 'name' | 'path'> & Partial<Pick<Repo,
  'git' | 'has_remote' | 'dirty' | 'untracked' | 'local_ok' | 'ahead' | 'branch' | 'upstream'>> & { pr?: Partial<Pr> };

export function isPlanRepo(value: unknown): value is PlanRepo {
  return isRecord(value)
    && typeof value['name'] === 'string'
    && typeof value['path'] === 'string'
    && (value['pr'] === undefined || isRecord(value['pr']));
}

export function reposFrom(payload: unknown): PlanRepo[] {
  const repos = isRecord(payload) ? payload['repos'] : undefined;
  return Array.isArray(repos) ? repos.filter(isPlanRepo) : [];
}

export function planRows(payload: unknown, rowFn: (repo: PlanRepo) => unknown[] | null | undefined): string {
  const lines: string[] = [];
  for (const repo of reposFrom(payload)) {
    const cells = rowFn(repo);
    if (cells) lines.push(cells.join('\t'));
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

export async function projectReposStdin(rowFn: (repo: PlanRepo) => unknown[] | null | undefined): Promise<void> {
  process.stdout.write(planRows(parseJson(await text(process.stdin)), rowFn));
}
