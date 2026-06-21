#!/usr/bin/env node
// repos --prs projector. `repos` fans out one `gh pr view --json` per repo into a
// temp dir (named <index>.json); this reads them back in one node process and
// emits one TSV line per repo so the shell can splice the result into its
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
// to the same clean default instead of an error.

import { readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2];
if (!dir) process.exit(0);

// statusCheckRollup mixes CheckRun objects (status + conclusion) and legacy
// StatusContext objects (state). One failing check ⇒ failing; otherwise any
// still-running/queued check (or one with no conclusion yet) ⇒ pending; else all
// concluded successfully ⇒ passing. Empty rollup ⇒ none.
function ciRollup(rollup) {
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

for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.json')) continue;
  const idx = file.replace(/\.json$/, '');
  let pr = null;
  try { pr = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8') || 'null'); } catch {}
  if (!pr || !pr.number) {
    process.stdout.write(`${idx}\t0\tnone\tnone\tnone\t\n`);
    continue;
  }
  const state = pr.isDraft ? 'draft' : String(pr.state || 'open').toLowerCase();
  const review = String(pr.reviewDecision || '').toLowerCase() || 'none';
  process.stdout.write([idx, pr.number, state, ciRollup(pr.statusCheckRollup), review, pr.url || ''].join('\t') + '\n');
}
