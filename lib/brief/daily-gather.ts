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
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { runCli } from "../sdk/cli.ts";
import { isRecord, parseJson } from "../sdk/guards.ts";

interface Repo { name?: string; path?: string }
interface BoardTask { doc_id?: string; title?: string; project?: string; closed?: string }

const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";

function isRepo(value: unknown): value is Repo {
  return isRecord(value) && optionalString(value['name']) && optionalString(value['path']);
}

function isBoardTask(value: unknown): value is BoardTask {
  return isRecord(value)
    && optionalString(value['doc_id'])
    && optionalString(value['title'])
    && optionalString(value['project'])
    && optionalString(value['closed']);
}

function nested(value: unknown, outer: string, inner: string): unknown {
  const group = isRecord(value) ? value[outer] : undefined;
  return isRecord(group) ? group[inner] : undefined;
}

function commitsOn(repoPath: string, date: string): string[] {
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

await runCli(async () => {
  const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });
  const date = positionals[0] || new Date().toISOString().slice(0, 10);
  const input = parseJson(await text(process.stdin));

  const repoField = nested(input, "repos", "repos");
  const repoList = Array.isArray(repoField) ? repoField.filter(isRepo) : [];
  const commits: { repo: string | undefined; subjects: string[] }[] = [];
  for (const r of repoList) {
    if (!r.path) continue;
    const subjects = commitsOn(r.path, date);
    if (subjects.length) commits.push({ repo: r.name, subjects });
  }

  const taskField = nested(input, "board", "tasks");
  const tasks = Array.isArray(taskField) ? taskField.filter(isBoardTask) : [];
  const closed = tasks
    .filter((t) => t.closed === date)
    .map((t) => ({ doc_id: t.doc_id, title: t.title, project: t.project }));

  process.stdout.write(JSON.stringify({ date, commits, closed }));
});
