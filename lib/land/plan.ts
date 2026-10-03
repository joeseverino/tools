#!/usr/bin/env node
// land/plan.ts — project a `repos --json --prs` payload to the rows land acts
// on: only repos with an OPEN PR, as
//   name <TAB> path <TAB> number <TAB> ci <TAB> url
// The stdin/parse plumbing is shared (repos/project.ts); this declares only
// land's filter and columns.
import { projectReposStdin } from "../repos/project.ts";
import type { Pr } from "../repos/pr.ts";

projectReposStdin((r) => {
  const pr: Partial<Pr> = r.pr || {};
  if (pr.state !== "open") return null;
  return [r.name, r.path, pr.number, pr.ci, pr.url];
});
