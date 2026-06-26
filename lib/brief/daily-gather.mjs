#!/usr/bin/env node
// brief/daily-gather.mjs — gather a day's activity for `vault daily`. The impure
// fold (it shells git), kept out of the pure renderer (daily.mjs) so that stays
// testable. It does NOT re-derive fleet state: `repos --json` owns the repo list
// (passed in), exactly as lib/repos/pr.mjs folds PR state over that same list —
// this folds each repo's commit log for the date.
//
//   stdin: { date, repos: <repos --json>, board: <backlog --json --all> }
//   stdout: { date, commits: [{repo, subjects:[...]}], closed: [{doc_id,title,project}] }

import { execFileSync } from "node:child_process";
import process from "node:process";

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

function commitsOn(repoPath) {
  try {
    const out = execFileSync(
      "git",
      ["-C", repoPath, "log", "--no-merges",
       "--since", `${date} 00:00:00`, "--until", `${date} 23:59:59`,
       "--pretty=%s"],
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    input = {};
  }

  const repoList = Array.isArray(input.repos?.repos) ? input.repos.repos : [];
  const commits = [];
  for (const r of repoList) {
    if (!r.path) continue;
    const subjects = commitsOn(r.path);
    if (subjects.length) commits.push({ repo: r.name, subjects });
  }

  const tasks = Array.isArray(input.board?.tasks) ? input.board.tasks : [];
  const closed = tasks
    .filter((t) => t.closed === date)
    .map((t) => ({ doc_id: t.doc_id, title: t.title, project: t.project }));

  process.stdout.write(JSON.stringify({ date, commits, closed }));
});
