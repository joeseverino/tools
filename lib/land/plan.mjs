#!/usr/bin/env node
// land/plan.mjs — project a `repos --json --prs` payload to the rows land acts
// on: only repos with an OPEN PR, as
//   name <TAB> path <TAB> number <TAB> ci <TAB> url
// The stdin/parse plumbing is shared (repos/project.mjs); this declares only
// land's filter and columns.
import { projectReposStdin } from "../repos/project.mjs";

projectReposStdin((r) => {
  const pr = r.pr || {};
  if (pr.state !== "open") return null;
  return [r.name, r.path, pr.number, pr.ci, pr.url];
});
