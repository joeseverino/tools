#!/usr/bin/env node
// json.mjs — the `repos --json` serializer. Reads collect()'s \x1f records from
// the scan temp dir (one file per scanned dir; an empty file = a filtered-out
// repo), projects each through record.mjs's buildRepo, attaches PR state from the
// --prs fan-out, and emits the fleet object with a real JSON.stringify. So the
// fleet's most-consumed contract is built once from the field manifest — never
// hand-concatenated with printf + json_escape.
//
// Usage: json.mjs --record-dir DIR --scan-count N [--root R]... [--icloud] [--pr-dir DIR]
import { readFileSync } from 'node:fs';
import { parseRecord, buildRepo } from './record.mjs';
import { projectPr, readPrBlob } from './pr.mjs';

const args = process.argv.slice(2);
const roots = [];
let recordDir = '';
let prDir = '';
let scanCount = 0;
let icloud = false;
for (let i = 0; i < args.length; i += 1) {
  switch (args[i]) {
    case '--record-dir': recordDir = args[i += 1]; break;
    case '--scan-count': scanCount = Number(args[i += 1]) || 0; break;
    case '--root': roots.push(args[i += 1]); break;
    case '--pr-dir': prDir = args[i += 1]; break;
    case '--icloud': icloud = true; break;
    default: break;
  }
}
const prs = Boolean(prDir);

const repos = [];
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
