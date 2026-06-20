#!/usr/bin/env node
// ship/plan.mjs — read a `repos --json` payload on stdin, emit one TSV line per
// repo that has something to ship (uncommitted changes or unpushed commits):
//
//   name <TAB> path <TAB> branch <TAB> uncommitted <TAB> ahead <TAB> has_remote
//
// Deterministic: ship reads this instead of re-deriving git state per repo.
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (s += c));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(s); } catch { d = {}; }
  for (const r of d.repos || []) {
    const uncommitted = (r.dirty || 0) + (r.untracked || 0);
    const unpushed = (r.ahead || 0) > 0 || (r.has_remote && !r.upstream);
    if (uncommitted === 0 && !unpushed) continue;
    process.stdout.write(
      [
        r.name,
        r.path,
        r.branch || "-",
        uncommitted,
        r.ahead || 0,
        r.has_remote ? 1 : 0,
      ].join("\t") + "\n",
    );
  }
});
