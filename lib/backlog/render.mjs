#!/usr/bin/env node
// render.mjs — the human view over the MCP's task board. Reads one
// `severino-vault-mcp task-list` JSON object on stdin (already filtered + ranked
// by the brain) and paints it. This file owns zero task logic — it only groups
// and prints. Emit once (the MCP), render many.
//
//   severino-vault-mcp task-list ... | render.mjs <board|list>

const mode = process.argv[2] === "list" ? "list" : "board";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(raw); } catch { data = {}; }
  if (data.ok === false) {
    process.stdout.write(`\n  ${RED}error${R}      ${data.error || "task-list failed"}\n\n`);
    process.exitCode = 1;
    return;
  }
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const staleDays = data.stale_days || 14;
  process.stdout.write((mode === "list" ? renderList : renderBoard)(tasks, staleDays) + "\n");
});

// ---- styling ----
const tty = process.stdout.isTTY;
const B = tty ? "\x1b[1m" : "", D = tty ? "\x1b[2m" : "", R = tty ? "\x1b[0m" : "";
const G = tty ? "\x1b[32m" : "", Y = tty ? "\x1b[33m" : "", RED = tty ? "\x1b[31m" : "";

const statusColor = (s) => ({ active: G, open: "", parked: D, done: D, wontfix: D }[s] ?? "");

function cell(s, w) {
  s = String(s ?? "");
  if ([...s].length > w) s = [...s].slice(0, w - 1).join("") + "…";
  const pad = w - [...s].length;
  return s + (pad > 0 ? " ".repeat(pad) : "");
}

// One task line. `showProject` adds the project cell (the flat list); the board
// drops it (the group header already names the project).
function row(t, { showProject = false } = {}) {
  const flags = t.stale ? `  ${Y}stale ${t.age_days}d${R}` : "";
  const meta = [t.priority, t.effort].filter(Boolean).join(" · ");
  const proj = showProject ? `${D}${cell(t.project, 16)}${R} ` : "";
  return `  ${statusColor(t.status)}${cell(t.status, 8)}${R} ${proj}${B}${cell(t.slug, 32)}${R} ${D}${cell(meta, 12)}${R} ${cell(t.title, 42)}${flags}`;
}

function header(count) {
  return `\n  ${B}backlog${R} ${count} task${count === 1 ? "" : "s"}\n`;
}

function summary(tasks, staleDays) {
  const staleN = tasks.filter((t) => t.stale).length;
  return `  ${D}summary${R}    ${tasks.length} shown · ${staleN} stale (>${staleDays}d)`;
}

function renderList(tasks, staleDays) {
  if (!tasks.length) return header(0) + `  ${D}none${R}`;
  return [header(tasks.length), "", ...tasks.map((t) => row(t, { showProject: true })), "", summary(tasks, staleDays)].join("\n");
}

function renderBoard(tasks, staleDays) {
  if (!tasks.length) return header(0) + `  ${D}none${R}`;
  // Group by project; the cross-cutting bucket sorts last, projects A→Z.
  const groups = {};
  for (const t of tasks) (groups[t.project] ||= []).push(t);
  const order = Object.keys(groups).sort((a, b) =>
    a === "cross" ? 1 : b === "cross" ? -1 : a.localeCompare(b));
  const out = [header(tasks.length)];
  for (const project of order) {
    out.push(`  ${B}${project}${R} ${D}(${groups[project].length})${R}`);
    for (const t of groups[project]) out.push(row(t));
    out.push("");
  }
  out.push(summary(tasks, staleDays));
  return out.join("\n");
}
