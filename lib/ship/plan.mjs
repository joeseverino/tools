#!/usr/bin/env node
// ship/plan.mjs — read a `repos --json` payload on stdin, emit one TSV line per
// repo that has something to ship (uncommitted changes or unpushed commits).
// With SHIP_INCLUDE_CLEAN_BRANCH=1 (set only by scoped `ship <name>` when PR
// creation is requested), also include a clean pushed feature branch so `ship`
// can open/update the PR after a prior push:
//
//   name <TAB> path <TAB> branch <TAB> uncommitted <TAB> ahead <TAB> has_remote
//
// Deterministic: ship reads this instead of re-deriving git state per repo.
let s = "";
const includeCleanBranch = process.env.SHIP_INCLUDE_CLEAN_BRANCH === "1";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (s += c));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(s); } catch { d = {}; }
  for (const r of d.repos || []) {
    const uncommitted = (r.dirty || 0) + (r.untracked || 0);
    const unpushed = (r.ahead || 0) > 0 || (r.has_remote && !r.upstream);
    const branch = r.branch || "-";
    const cleanFeatureBranch = includeCleanBranch
      && r.has_remote
      && uncommitted === 0
      && !unpushed
      && branch !== "main"
      && branch !== "master"
      && branch !== "-";
    if (uncommitted === 0 && !unpushed && !cleanFeatureBranch) continue;
    process.stdout.write(
      [
        r.name,
        r.path,
        branch,
        uncommitted,
        r.ahead || 0,
        r.has_remote ? 1 : 0,
      ].join("\t") + "\n",
    );
  }
});
