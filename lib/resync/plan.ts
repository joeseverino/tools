#!/usr/bin/env node
// resync/plan.ts — project a `repos --json` payload to the rows resync needs:
// only git repos with a remote, as
//   name <TAB> path <TAB> dirty-count
// The stdin/parse plumbing is shared (repos/project.ts); this declares only
// resync's filter and columns.
import { projectReposStdin } from "../repos/project.ts";

await projectReposStdin((r) => {
  if (!r.git || !r.has_remote) return null;
  return [r.name, r.path, (r.dirty || 0) + (r.untracked || 0)];
});
