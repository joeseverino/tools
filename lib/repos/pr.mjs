#!/usr/bin/env node
// repos --prs projector. `repos` fans out one `gh pr view --json` per repo into a
// temp dir (named <index>.json). The CLI here reads them back in one node process
// and emits one TSV line per repo so the shell can splice the result into its
// parallel arrays without a JSON parser per repo:
//
//   <index>\t<number>\t<state>\t<ci>\t<review>\t<url>
//
//   state : open | draft | closed | merged | none
//   ci    : passing | failing | pending | none   (rollup over statusCheckRollup)
//   review: approved | changes_requested | review_required | none
//
// A missing/empty/PR-less blob emits "<index>\t0\tnone\tnone\tnone\t" — repos
// treats that as "no open PR", so a repo with no gh, no auth, or no PR degrades
// to the same clean default instead of an error. The same projection feeds
// json.mjs (the --json surface), so the PR shape is derived in one place.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// statusCheckRollup mixes CheckRun objects (status + conclusion) and legacy
// StatusContext objects (state). One failing check ⇒ failing; otherwise any
// still-running/queued check (or one with no conclusion yet) ⇒ pending; else all
// concluded successfully ⇒ passing. Empty rollup ⇒ none.
export function ciRollup(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  const concl = (c) => String(c.conclusion || '').toUpperCase();
  const state = (c) => String(c.state || '').toUpperCase();
  const status = (c) => String(c.status || '').toUpperCase();
  if (rollup.some((c) => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE/.test(concl(c) || state(c)))) {
    return 'failing';
  }
  if (rollup.some((c) => /IN_PROGRESS|QUEUED|PENDING|WAITING|REQUESTED|EXPECTED/.test(status(c) || state(c))
      || (!concl(c) && status(c) !== 'COMPLETED' && state(c) !== 'SUCCESS'))) {
    return 'pending';
  }
  return 'passing';
}

// Project one raw `gh pr view` blob (or null/PR-less) into the contracted PR
// shape. A missing PR degrades to the "no open PR" default, never an error.
export function projectPr(raw) {
  if (!raw || !raw.number) return { number: 0, state: 'none', ci: 'none', review: 'none', url: '' };
  return {
    number: raw.number,
    state: raw.isDraft ? 'draft' : String(raw.state || 'open').toLowerCase(),
    ci: ciRollup(raw.statusCheckRollup),
    review: String(raw.reviewDecision || '').toLowerCase() || 'none',
    url: raw.url || '',
  };
}

// Read a fanned-out gh blob for index <idx> from <dir>, or null if absent/garbage.
export function readPrBlob(dir, idx) {
  try { return JSON.parse(readFileSync(`${dir}/${idx}.json`, 'utf8') || 'null'); } catch { return null; }
}

function main(dir) {
  if (!dir) process.exit(0);
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const idx = file.replace(/\.json$/, '');
    const p = projectPr(readPrBlob(dir, idx));
    process.stdout.write([idx, p.number, p.state, p.ci, p.review, p.url].join('\t') + '\n');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
