#!/usr/bin/env node
// gate-preview/report.ts: the JSON shaping behind `gate-preview`.
//
//   paths                     repos --json on stdin  -> one repo path per line
//   verdict                   checks-engine --json on stdin -> "ok" | "RED a,b" | "ERROR no verdict"
//   rows <name|verdict>...    the per-repo rows as one {ok, repos} JSON document
import { text } from 'node:stream/consumers';
import { isRecord, isStringArray, parseJson } from '../sdk/guards.ts';

export function repoPaths(payload: unknown): string[] {
  const repos = isRecord(payload) ? payload['repos'] ?? payload : payload;
  if (!Array.isArray(repos)) return [];
  return repos.flatMap((repo) => (isRecord(repo) && typeof repo['path'] === 'string' ? [repo['path']] : []));
}

export function verdictOf(report: unknown): string {
  if (!isRecord(report)) return 'ERROR no verdict';
  if (report['ok']) return 'ok';
  return isStringArray(report['failed']) ? `RED ${report['failed'].join(',')}` : 'ERROR no verdict';
}

interface Row { repo: string | undefined; ok: boolean; failed?: string[] }

export function rowsOf(rows: string[]): { ok: boolean; repos: Row[] } {
  const repos = rows.map((row): Row => {
    const [repo, verdict = ''] = row.split('|');
    return { repo, ok: verdict === 'ok', ...(verdict.startsWith('RED') ? { failed: verdict.slice(4).split(',') } : {}) };
  });
  return { ok: repos.every((row) => row.ok), repos };
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'paths':
      for (const path of repoPaths(parseJson(await text(process.stdin)))) console.log(path);
      break;
    case 'verdict':
      console.log(verdictOf(parseJson(await text(process.stdin))));
      break;
    case 'rows':
      console.log(JSON.stringify(rowsOf(args)));
      break;
    default:
      console.error('usage: report.ts <paths|verdict|rows> [args...]');
      process.exitCode = 2;
  }
}
