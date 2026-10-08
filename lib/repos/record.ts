// The per-repo record collected by the scan and its projection into the
// published `repos --json` shape (schemas/repos.schema.json).
import type { Pr } from './pr.ts';

export type ParsedRecord = {
  name: string; root: string; path: string; git: boolean; branch: string;
  remote: string; has_remote: boolean; dirty: number; untracked: number;
  ahead: number; behind: number; upstream: boolean; upstream_name: string;
  upstream_track: string; upstream_gone: boolean; sha: string; date: string;
  subject: string; lang: string; pm: string; package_manager: string;
  nvmrc: string; node_modules: boolean; node_modules_size: string | null; ci: number;
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
  node_modules_size: string | null; ci: number;
  branch_state: string;
  icloud_dups?: number;
  pr?: Pr;
}

// last_commit nests sha/date/subject; icloud_dups rides only under --icloud; pr
// rides only under --prs. An open PR corrects the network-free branch_state hint
// to "pr".
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
