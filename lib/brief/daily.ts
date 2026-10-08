#!/usr/bin/env node
// brief/daily.ts — render the daily note's region as a log of what you DID that
// day: commits across the fleet + work shipped (tasks closed). A daily note is
// retrospective — the cockpit shows pending work; this shows the record.
//
// PURE: reads an activity object on stdin and emits markdown. The git/closed
// gathering lives in daily-gather.ts (the impure fold), so this stays testable.
//   stdin: { commits: [{repo, subjects:[...]}], closed: [{doc_id, title, project}] }
//   argv[2]: ISO date for the header.
//
// SECTIONS is the single declarative list — add a kind of "what I did" by editing
// one entry. Empty sections drop, so a quiet day is just the header (you write
// the rest below the region by hand).

import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { runCli } from '../sdk/cli.ts';
import { isRecord, isStringArray, parseJson } from '../sdk/guards.ts';

interface Commits { repo: string; subjects: string[] }
interface Closed { doc_id: string; title: string; project?: string }
interface Activity {
  commits: Commits[];
  closed: Closed[];
}

function isCommits(value: unknown): value is Commits {
  return isRecord(value) && typeof value['repo'] === 'string' && isStringArray(value['subjects']);
}

function isClosed(value: unknown): value is Closed {
  return isRecord(value)
    && typeof value['doc_id'] === 'string'
    && typeof value['title'] === 'string'
    && (value['project'] === undefined || typeof value['project'] === 'string');
}

function list<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}
interface Section {
  title: string;
  callout: string;
  open: boolean;
  lines: (a: Activity) => string[];
}

const SECTIONS: Section[] = [
  {
    title: "Commits",
    callout: "abstract",
    open: true,
    lines: (a) => a.commits.flatMap((r) => r.subjects.map((s) => `**${r.repo}** — ${s}`)),
  },
  {
    title: "Shipped",
    callout: "success",
    open: true,
    lines: (a) => a.closed.map((t) => `[[${t.doc_id}|${t.title}]]${t.project ? ` · ${t.project}` : ""}`),
  },
];

function summaryLine(a: Activity): string {
  const commits = a.commits.reduce((n, r) => n + r.subjects.length, 0);
  const parts: string[] = [];
  if (commits) parts.push(`${commits} commit${commits === 1 ? "" : "s"}`);
  if (a.closed.length) parts.push(`${a.closed.length} shipped`);
  return parts.length ? parts.join(" · ") : "nothing recorded yet — log it below";
}

function callout(title: string, type: string, open: boolean, lines: string[]): string {
  return [`> [!${type}]${open ? "+" : "-"} ${title}`, ...lines.map((l) => `> - ${l}`)].join("\n");
}

export function render(input: unknown, isoDate: string): string {
  const a: Activity = {
    commits: list(isRecord(input) ? input['commits'] : undefined, isCommits),
    closed: list(isRecord(input) ? input['closed'] : undefined, isClosed),
  };
  const blocks = [`> [!note] ${isoDate}\n> ${summaryLine(a)}`];
  for (const s of SECTIONS) {
    const lines = s.lines(a).filter(Boolean);
    if (!lines.length) continue;
    blocks.push(callout(s.title, s.callout, s.open, lines));
  }
  return blocks.join("\n\n");
}

if (import.meta.main) {
  await runCli(async () => {
    const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });
    const isoDate = positionals[0] || new Date().toISOString().slice(0, 10);
    process.stdout.write(render(parseJson(await text(process.stdin)), isoDate) + "\n");
  });
}
