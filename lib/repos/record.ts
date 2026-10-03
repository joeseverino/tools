// record.ts — THE single source of truth for the `repos --json` per-repo record.
//
// `bin/repos` collect() emits one \x1f-delimited line per repo in exactly the
// RECORD_FIELDS order below; this module parses that line (typed) and projects it
// into the published JSON shape, which json.ts serializes with a real
// JSON.stringify. So the fleet's most-consumed contract is built once, here — not
// hand-concatenated with printf + json_escape in three places kept in lockstep.
//
// Add or reorder a field: edit RECORD_FIELDS (and the matching slot in collect's
// printf). The schema-parity test in tests/repos-project.bats keeps
// schemas/repos.schema.json from drifting from buildRepo's output shape.

// Ordered to match collect()'s printf in bin/repos. `type` drives parsing:
//   string → as-is · int → Number · bool → "1"|"true" → boolean · raw → JSON.parse
// (node_modules_size is emitted as a JSON literal already: `null` or `"4.2M"`).
import type { Pr } from './pr.ts';

type FieldType = 'string' | 'int' | 'bool' | 'raw';

export type ParsedRecord = {
  name: string; root: string; path: string; git: boolean; branch: string;
  remote: string; has_remote: boolean; dirty: number; untracked: number;
  ahead: number; behind: number; upstream: boolean; upstream_name: string;
  upstream_track: string; upstream_gone: boolean; sha: string; date: string;
  subject: string; lang: string; pm: string; package_manager: string;
  nvmrc: string; node_modules: boolean; node_modules_size: unknown; ci: number;
  icloud_dups: number; stash: number; local_ok: boolean; needs_ship: boolean;
  needs_resync: boolean; needs_attention: boolean; branch_state: string;
};

export interface Repo {
  name: string; path: string; root: string; git: boolean;
  branch: string; remote: string; has_remote: boolean;
  dirty: number; untracked: number; ahead: number; behind: number;
  upstream: boolean; upstream_name: string;
  upstream_track: string; upstream_gone: boolean;
  local_ok: boolean; needs_ship: boolean;
  needs_resync: boolean; needs_attention: boolean;
  stash: number;
  last_commit: { sha: string; date: string; subject: string };
  lang: string; pm: string; package_manager: string;
  nvmrc: string; node_modules: boolean;
  node_modules_size: unknown; ci: number;
  branch_state: string;
  icloud_dups?: number;
  pr?: Pr;
}

export const RECORD_FIELDS: readonly { key: keyof ParsedRecord; type: FieldType }[] = [
  { key: 'name', type: 'string' },
  { key: 'root', type: 'string' },             // collect emits root_label here
  { key: 'path', type: 'string' },
  { key: 'git', type: 'bool' },                // collect emits is_git
  { key: 'branch', type: 'string' },
  { key: 'remote', type: 'string' },
  { key: 'has_remote', type: 'bool' },
  { key: 'dirty', type: 'int' },
  { key: 'untracked', type: 'int' },
  { key: 'ahead', type: 'int' },
  { key: 'behind', type: 'int' },
  { key: 'upstream', type: 'bool' },
  { key: 'upstream_name', type: 'string' },
  { key: 'upstream_track', type: 'string' },
  { key: 'upstream_gone', type: 'bool' },
  { key: 'sha', type: 'string' },              // → last_commit.sha
  { key: 'date', type: 'string' },             // → last_commit.date
  { key: 'subject', type: 'string' },          // → last_commit.subject
  { key: 'lang', type: 'string' },
  { key: 'pm', type: 'string' },
  { key: 'package_manager', type: 'string' },  // collect emits pmfield
  { key: 'nvmrc', type: 'string' },
  { key: 'node_modules', type: 'bool' },       // collect emits nm
  { key: 'node_modules_size', type: 'raw' },   // null | "4.2M"
  { key: 'ci', type: 'int' },
  { key: 'icloud_dups', type: 'int' },         // emitted to JSON only under --icloud
  { key: 'stash', type: 'int' },
  { key: 'local_ok', type: 'bool' },
  { key: 'needs_ship', type: 'bool' },
  { key: 'needs_resync', type: 'bool' },
  { key: 'needs_attention', type: 'bool' },
  { key: 'branch_state', type: 'string' },
];

function coerce(type: FieldType, raw: string | undefined): unknown {
  switch (type) {
    case 'int': return Number(raw) || 0;
    case 'bool': return raw === '1' || raw === 'true';
    case 'raw': try { return JSON.parse(raw ?? 'undefined'); } catch { return null; }
    default: return raw ?? '';
  }
}

// Parse one \x1f-delimited collect record into a typed flat object. collect emits
// a trailing \x1f and newline, so split yields an extra empty tail we ignore.
export function parseRecord(line: string): ParsedRecord {
  const f = line.replace(/\n$/, '').split('\x1f');
  const rec: Record<string, unknown> = {};
  RECORD_FIELDS.forEach((field, i) => { rec[field.key] = coerce(field.type, f[i]); });
  return rec as ParsedRecord;
}

// Project a parsed record into the published JSON repo shape: last_commit nests
// sha/date/subject; icloud_dups rides only under --icloud; pr rides only under
// --prs. An open PR also corrects the network-free branch_state hint to "pr".
export function buildRepo(
  rec: ParsedRecord,
  { icloud = false, pr = null }: { icloud?: boolean; pr?: Pr | null } = {},
): Repo {
  const repo: Repo = {
    name: rec.name, path: rec.path, root: rec.root, git: rec.git,
    branch: rec.branch, remote: rec.remote, has_remote: rec.has_remote,
    dirty: rec.dirty, untracked: rec.untracked, ahead: rec.ahead, behind: rec.behind,
    upstream: rec.upstream, upstream_name: rec.upstream_name,
    upstream_track: rec.upstream_track, upstream_gone: rec.upstream_gone,
    local_ok: rec.local_ok, needs_ship: rec.needs_ship,
    needs_resync: rec.needs_resync, needs_attention: rec.needs_attention,
    stash: rec.stash,
    last_commit: { sha: rec.sha, date: rec.date, subject: rec.subject },
    lang: rec.lang, pm: rec.pm, package_manager: rec.package_manager,
    nvmrc: rec.nvmrc, node_modules: rec.node_modules,
    node_modules_size: rec.node_modules_size, ci: rec.ci,
    branch_state: rec.branch_state,
  };
  if (icloud) repo.icloud_dups = rec.icloud_dups;
  if (pr) {
    repo.pr = pr;
    if (pr.state === 'open') repo.branch_state = 'pr';
  }
  return repo;
}
