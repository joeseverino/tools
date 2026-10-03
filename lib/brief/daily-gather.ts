#!/usr/bin/env node
// brief/daily-gather.ts — gather a day's activity for `vault daily`. The impure
// fold (it shells git), kept out of the pure renderer (daily.ts) so that stays
// testable. It does NOT re-derive fleet state: `repos --json` owns the repo list
// (passed in), exactly as lib/repos/pr.ts folds PR state over that same list —
// this folds each repo's commit log for the date.
//
//   stdin: { date, repos: <repos --json>, board: <backlog --json --all> }
//   stdout: { date, commits: [{repo, subjects:[...]}], closed: [{doc_id,title,project}] }

import { execFileSync } from "node:child_process";
import process from "node:process";

interface Repo { name?: string; path?: string }
interface BoardTask { doc_id?: string; title?: string; project?: string; closed?: string }
interface GatherInput {
  repos?: { repos?: unknown };
  board?: { tasks?: unknown };
}

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

function commitsOn(repoPath: string): string[] {
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
  let input: GatherInput = {};
  try {
    input = JSON.parse(raw) as GatherInput;
  } catch {
    input = {};
  }

  const repoList: Repo[] = Array.isArray(input.repos?.repos) ? input.repos.repos as Repo[] : [];
  const commits: { repo: string | undefined; subjects: string[] }[] = [];
  for (const r of repoList) {
    if (!r.path) continue;
    const subjects = commitsOn(r.path);
    if (subjects.length) commits.push({ repo: r.name, subjects });
  }

  const tasks: BoardTask[] = Array.isArray(input.board?.tasks) ? input.board.tasks as BoardTask[] : [];
  const closed = tasks
    .filter((t) => t.closed === date)
    .map((t) => ({ doc_id: t.doc_id, title: t.title, project: t.project }));

  process.stdout.write(JSON.stringify({ date, commits, closed }));
});
