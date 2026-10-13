// JSON shaping behind `gate-preview`: repo paths from `repos --json`, a verdict
// string per checks-engine report, and the per-repo rows document.
import { isRecord, isStringArray } from '../sdk/guards.ts';

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
