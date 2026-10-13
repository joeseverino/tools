// Open-PR projection for `repos --prs`: one `gh pr view --json` blob per repo
// becomes the contracted PR shape.
//
//   state : open | draft | closed | merged | none
//   ci    : passing | failing | pending | none   (rollup over statusCheckRollup)
//   review: approved | changes_requested | review_required | none
//
// A missing/empty/PR-less blob projects to number 0 / state none, so a repo with
// no gh, no auth, or no PR degrades to the same clean default instead of an error.
import { isRecord, parseJson } from '../sdk/guards.ts';

interface CheckEntry { conclusion?: unknown; state?: unknown; status?: unknown }

// A `gh pr view --json` blob; only the fields projectPr reads.
export interface GhPrBlob {
  number?: number | null;
  isDraft?: boolean | null;
  state?: string | null;
  statusCheckRollup?: unknown;
  reviewDecision?: string | null;
  url?: string | null;
}

export interface Pr { number: number; state: string; ci: string; review: string; url: string }

// statusCheckRollup mixes CheckRun objects (status + conclusion) and legacy
// StatusContext objects (state). One failing check ⇒ failing; otherwise any
// still-running/queued check (or one with no conclusion yet) ⇒ pending; else all
// concluded successfully ⇒ passing. Empty rollup ⇒ none.
export function ciRollup(rollup: unknown): string {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  const concl = (c: CheckEntry) => String(c.conclusion || '').toUpperCase();
  const state = (c: CheckEntry) => String(c.state || '').toUpperCase();
  const status = (c: CheckEntry) => String(c.status || '').toUpperCase();
  if (rollup.some((c: CheckEntry) => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE/.test(concl(c) || state(c)))) {
    return 'failing';
  }
  if (rollup.some((c: CheckEntry) => /IN_PROGRESS|QUEUED|PENDING|WAITING|REQUESTED|EXPECTED/.test(status(c) || state(c))
      || (!concl(c) && status(c) !== 'COMPLETED' && state(c) !== 'SUCCESS'))) {
    return 'pending';
  }
  return 'passing';
}

// Project one raw `gh pr view` blob (or null/PR-less) into the contracted PR
// shape. A missing PR degrades to the "no open PR" default, never an error.
export function projectPr(raw: GhPrBlob | null | undefined): Pr {
  if (!raw || !raw.number) return { number: 0, state: 'none', ci: 'none', review: 'none', url: '' };
  return {
    number: raw.number,
    state: raw.isDraft ? 'draft' : String(raw.state || 'open').toLowerCase(),
    ci: ciRollup(raw.statusCheckRollup),
    review: String(raw.reviewDecision || '').toLowerCase() || 'none',
    url: raw.url || '',
  };
}

const optional = (value: unknown, type: 'string' | 'number' | 'boolean'): boolean =>
  value == null || typeof value === type;

function isGhPrBlob(value: unknown): value is GhPrBlob {
  return isRecord(value)
    && optional(value['number'], 'number')
    && optional(value['isDraft'], 'boolean')
    && optional(value['state'], 'string')
    && optional(value['reviewDecision'], 'string')
    && optional(value['url'], 'string');
}

// Parse the stdout of one `gh pr view --json` call, or null if empty/garbage.
export function parsePrBlob(text: string): GhPrBlob | null {
  const blob = parseJson(text || 'null');
  return isGhPrBlob(blob) ? blob : null;
}
