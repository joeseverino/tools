#!/usr/bin/env node
// json.ts — the `repos --json` serializer. Reads collect()'s \x1f records from
// the scan temp dir (one file per scanned dir; an empty file = a filtered-out
// repo), projects each through record.ts's buildRepo, attaches PR state from the
// --prs fan-out, and emits the fleet object with a real JSON.stringify. So the
// fleet's most-consumed contract is built once from the field manifest — never
// hand-concatenated with printf + json_escape.
//
// Usage: json.ts --record-dir DIR --scan-count N [--root R]... [--icloud] [--pr-dir DIR]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseRecord, buildRepo } from './record.ts';
import { projectPr, readPrBlob } from './pr.ts';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'record-dir': { type: 'string', default: '' },
    'scan-count': { type: 'string', default: '0' },
    root: { type: 'string', multiple: true, default: [] },
    'pr-dir': { type: 'string', default: '' },
    icloud: { type: 'boolean', default: false },
  },
  strict: true,
});
const recordDir = values['record-dir'];
const scanCount = Number(values['scan-count']) || 0;
const roots = values.root;
const prDir = values['pr-dir'];
const icloud = values.icloud;
const prs = Boolean(prDir);

const repos: ReturnType<typeof buildRepo>[] = [];
for (let i = 0; i < scanCount; i += 1) {
  let line = '';
  try { line = readFileSync(`${recordDir}/${i}`, 'utf8'); } catch { line = ''; }
  if (!line.trim()) continue;            // filtered-out repo (collect emitted nothing)
  const rec = parseRecord(line);
  // Dense merged index: the PR fan-out keyed its blobs by this same order.
  const j = repos.length;
  const pr = prs ? projectPr(readPrBlob(prDir, j)) : null;
  repos.push(buildRepo(rec, { icloud, pr }));
}

process.stdout.write(`${JSON.stringify({ ok: true, roots, count: repos.length, repos })}\n`);
