#!/usr/bin/env node
// render.ts — the human view over the MCP's task board. Reads one
// `severino-vault-mcp task-list` JSON object on stdin (already filtered + ranked
// by the brain) and paints it. This file owns zero task logic — it only groups
// and prints. Emit once (the MCP), render many.
//
//   severino-vault-mcp task-list ... | render.ts <board|list>

import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { runCli } from '../sdk/cli.ts';
import { paint } from '../sdk/color.ts';
import type { Style } from '../sdk/color.ts';
import { isRecord, parseJson } from '../sdk/guards.ts';

// One task row as task-list emits it; only the fields this view reads.
interface Task {
  project: string;
  status: string;
  slug: string;
  title: string;
  priority?: string;
  effort?: string;
  stale?: boolean;
  age_days?: number;
}

const optional = (value: unknown, type: 'string' | 'number' | 'boolean'): boolean =>
  value === undefined || typeof value === type;

function isTask(value: unknown): value is Task {
  return isRecord(value)
    && typeof value['project'] === 'string'
    && typeof value['status'] === 'string'
    && typeof value['slug'] === 'string'
    && typeof value['title'] === 'string'
    && optional(value['priority'], 'string')
    && optional(value['effort'], 'string')
    && optional(value['stale'], 'boolean')
    && optional(value['age_days'], 'number');
}

const STATUS_STYLES: Record<string, Style> = { active: 'green', parked: 'dim', done: 'dim', wontfix: 'dim' };

function cell(s: unknown, w: number): string {
  let str = String(s ?? "");
  if ([...str].length > w) str = [...str].slice(0, w - 1).join("") + "…";
  const pad = w - [...str].length;
  return str + (pad > 0 ? " ".repeat(pad) : "");
}

// One task line. `showProject` adds the project cell (the flat list); the board
// drops it (the group header already names the project).
function row(t: Task, { showProject = false }: { showProject?: boolean } = {}): string {
  const flags = t.stale ? `  ${paint('yellow', `stale ${t.age_days}d`)}` : "";
  const meta = [t.priority, t.effort].filter(Boolean).join(" · ");
  const proj = showProject ? `${paint('dim', cell(t.project, 16))} ` : "";
  const status = cell(t.status, 8);
  const statusStyle = STATUS_STYLES[t.status];
  return `  ${statusStyle ? paint(statusStyle, status) : status} ${proj}${paint('bold', cell(t.slug, 32))} ${paint('dim', cell(meta, 12))} ${cell(t.title, 42)}${flags}`;
}

function header(count: number): string {
  return `\n  ${paint('bold', 'backlog')} ${count} task${count === 1 ? "" : "s"}\n`;
}

function summary(tasks: Task[], staleDays: number): string {
  const staleN = tasks.filter((t) => t.stale).length;
  return `  ${paint('dim', 'summary')}    ${tasks.length} shown · ${staleN} stale (>${staleDays}d)`;
}

function renderList(tasks: Task[], staleDays: number): string {
  if (!tasks.length) return header(0) + `  ${paint('dim', 'none')}`;
  return [header(tasks.length), "", ...tasks.map((t) => row(t, { showProject: true })), "", summary(tasks, staleDays)].join("\n");
}

function renderBoard(tasks: Task[], staleDays: number): string {
  if (!tasks.length) return header(0) + `  ${paint('dim', 'none')}`;
  // Group by project; the cross-cutting bucket sorts last, projects A→Z.
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) (groups[t.project] ||= []).push(t);
  const order = Object.keys(groups).sort((a, b) =>
    a === "cross" ? 1 : b === "cross" ? -1 : a.localeCompare(b));
  const out = [header(tasks.length)];
  for (const project of order) {
    const group = groups[project] ?? [];
    out.push(`  ${paint('bold', project)} ${paint('dim', `(${group.length})`)}`);
    for (const t of group) out.push(row(t));
    out.push("");
  }
  out.push(summary(tasks, staleDays));
  return out.join("\n");
}

await runCli(async () => {
  const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });
  const mode = positionals[0] === "list" ? "list" : "board";

  const data = parseJson(await text(process.stdin));
  const payload = isRecord(data) ? data : {};
  if (payload['ok'] === false) {
    const message = typeof payload['error'] === 'string' && payload['error'] ? payload['error'] : "task-list failed";
    process.stdout.write(`\n  ${paint('red', 'error')}      ${message}\n\n`);
    process.exitCode = 1;
    return;
  }
  const tasks = Array.isArray(payload['tasks']) ? payload['tasks'].filter(isTask) : [];
  const staleDays = typeof payload['stale_days'] === 'number' && payload['stale_days'] ? payload['stale_days'] : 14;
  process.stdout.write((mode === "list" ? renderList : renderBoard)(tasks, staleDays) + "\n");
});
