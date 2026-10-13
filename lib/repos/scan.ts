// Fleet scan: list the repo directories under the roots, collect each one in a
// worker thread (the per-repo git work is independent and dominates), and fan
// the open-PR lookups out in parallel. Results keep directory order.
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { ghBin } from '../git/index.ts';
import { isDir } from './collect.ts';
import type { CollectJob, CollectOptions } from './collect.ts';
import { parsePrBlob, projectPr } from './pr.ts';
import type { Pr } from './pr.ts';
import type { ParsedRecord } from './record.ts';

export interface ScanRequest {
  roots: readonly string[];
  nameFilter: string;
  options: CollectOptions;
}

const byName = new Intl.Collator('en-US');

// Hidden entries are excluded and symlinked directories are kept. ICU collation
// gives the same order on every machine, independent of the system locale.
function listDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && isDirEntry(root, entry))
    .map((entry) => entry.name)
    .sort(byName.compare)
    .map((name) => path.join(root, name));
}

function isDirEntry(root: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(path.join(root, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Exact-name preference: when NAME names a repo directory exactly, match only
 * that one, so `ship cordon` never reaches `cordon-starter`. Otherwise substring.
 */
export function jobsFor(request: ScanRequest): CollectJob[] {
  const { roots, nameFilter, options } = request;
  const exact = nameFilter !== '' && roots.some((root) => isDir(`${root}/${nameFilter}`));
  const jobs: CollectJob[] = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const label = path.basename(root);
    for (const dir of listDirs(root)) {
      const name = path.basename(dir);
      if (nameFilter !== '' && (exact ? name !== nameFilter : !name.includes(nameFilter))) continue;
      jobs.push({ dir, name, root: label, options });
    }
  }
  return jobs;
}

function collectInWorker(job: CollectJob): Promise<ParsedRecord | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scan-worker.ts', import.meta.url), { workerData: job });
    worker.once('message', (record: ParsedRecord | null) => resolve(record));
    worker.once('error', reject);
  });
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item);
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function scan(request: ScanRequest): Promise<ParsedRecord[]> {
  const records = await mapLimit(jobsFor(request), Math.max(4, availableParallelism()), collectInWorker);
  return records.filter((record): record is ParsedRecord => record !== null);
}

function ghPrView(record: ParsedRecord): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ghBin(), ['pr', 'view', record.branch, '--json', 'number,url,state,isDraft,reviewDecision,statusCheckRollup'], {
      cwd: record.path,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { out += chunk; });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out));
  });
}

/** Open-PR state per repo, in record order. Repos without a remote branch stay at the no-PR default. */
export async function fetchPrs(records: readonly ParsedRecord[]): Promise<Pr[]> {
  return mapLimit(records, Math.max(4, availableParallelism()), async (record) => {
    if (!record.git || !record.has_remote || record.branch === '-') return projectPr(null);
    return projectPr(parsePrBlob(await ghPrView(record)));
  });
}
