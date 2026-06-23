#!/usr/bin/env node
// ship/plan.mjs — project a `repos --json` payload to one TSV row per repo that
// has something to ship (uncommitted changes or unpushed commits):
//
//   name <TAB> path <TAB> branch <TAB> uncommitted <TAB> ahead <TAB> has_remote
//
// With SHIP_INCLUDE_CLEAN_BRANCH=1 (set only by scoped `ship <name>` when PR
// creation is requested), also include a clean pushed feature branch so `ship`
// can open/update the PR after a prior push. ship reads this instead of
// re-deriving git state per repo; the stdin/parse plumbing is shared
// (repos/project.mjs).
import { projectReposStdin } from "../repos/project.mjs";

const includeCleanBranch = process.env.SHIP_INCLUDE_CLEAN_BRANCH === "1";

projectReposStdin((r) => {
  const uncommitted = (r.dirty || 0) + (r.untracked || 0);
  const localOk = !!r.local_ok;
  const unpushed = (r.ahead || 0) > 0 || (r.has_remote && !r.upstream && !localOk);
  const branch = r.branch || "-";
  const cleanFeatureBranch = includeCleanBranch
    && r.has_remote
    && uncommitted === 0
    && !unpushed
    && branch !== "main"
    && branch !== "master"
    && branch !== "-";
  if (uncommitted === 0 && !unpushed && !cleanFeatureBranch) return null;
  return [r.name, r.path, branch, uncommitted, r.ahead || 0, r.has_remote ? 1 : 0];
});
