#!/usr/bin/env node
// brief/daily.mjs — render the daily note's brief region as native Obsidian
// callouts. One renderer, consumed by `vault daily` (and, via shelling that, the
// Obsidian plugin), so the CLI and the plugin can never drift.
//
// Input on stdin: { brief, board } — `brief` is the brief --json digest (repos
// work + vault counts), `board` is backlog --json (the actual open tasks). The
// renderer composes the two owned sources; it re-derives nothing. It emits the
// region BODY only — the MIRROR markers are owned by the MCP's `daily-write`.
//
// SECTIONS is the single, declarative list: {title, callout, open, lines(d),
// count?(d)}. Add or reorder a section by editing one entry — empty sections are
// dropped, so the note stays a focused "what needs me today", not a data dump.
//
// argv[2] = ISO date for the header (the note's date).

const isoDate = process.argv[2] || new Date().toISOString().slice(0, 10);

const PRIORITY_RANK = { high: 0, med: 1, low: 2 };
const TASK_CAP = 12; // a daily glance, not the whole board — overflow points at `backlog`

// Open tasks, most-actionable first: stale (rotting) ahead of fresh, then by
// priority. Each renders as a wikilink to its task file + project · effort tags.
function backlogLines(board) {
  const all = Array.isArray(board.tasks) ? board.tasks : [];
  const sorted = [...all].sort(
    (a, b) =>
      Number(Boolean(b.stale)) - Number(Boolean(a.stale)) ||
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1),
  );
  const lines = sorted.slice(0, TASK_CAP).map((t) => {
    const tags = [t.project, t.priority, t.effort, t.stale ? "stale" : ""]
      .filter(Boolean)
      .join(" · ");
    return `[[${t.doc_id}|${t.title}]]${tags ? `  — ${tags}` : ""}`;
  });
  if (sorted.length > TASK_CAP) lines.push(`… +${sorted.length - TASK_CAP} more — \`backlog\``);
  return lines;
}

const SECTIONS = [
  {
    title: "Workspace",
    callout: "todo",
    open: true,
    lines: ({ brief }) => [
      ...brief.repos.ship.map((n) => `\`ship ${n} --check --watch --go\``),
      ...brief.repos.stale.map((n) => `\`ship ${n} --rebranch --go\` — stale branch`),
      ...brief.repos.resync.map((n) => `\`resync ${n}\` — merged, reconcile`),
    ],
  },
  {
    title: "Backlog — open work",
    callout: "abstract",
    open: true,
    count: ({ board }) => (board.tasks || []).length,
    lines: ({ board }) => backlogLines(board),
  },
  {
    title: "Docs to review",
    callout: "info",
    open: true,
    count: ({ brief }) => brief.vault.docs_to_review,
    lines: ({ brief }) => brief.vault.docs_to_review_top.map((id) => `[[${id}]]`),
  },
  {
    title: "Writeup drafts",
    callout: "note",
    open: false,
    lines: ({ brief }) => brief.writeups.drafts.map((s) => `[[${s}]]`),
  },
];

function summaryLine(brief) {
  const parts = [];
  if (brief.backlog.open) parts.push(`${brief.backlog.open} open tasks`);
  if (brief.backlog.stale) parts.push(`${brief.backlog.stale} stale`);
  if (brief.vault.docs_to_review) parts.push(`${brief.vault.docs_to_review} to review`);
  if (brief.vault.inbox) parts.push(`inbox ${brief.vault.inbox}`);
  if (brief.vault.recent_changes) parts.push(`${brief.vault.recent_changes} changed (7d)`);
  return parts.length ? parts.join(" · ") : "all clear";
}

function callout(title, type, open, lines, count) {
  const head = count ? `${title} (${count})` : title;
  return [`> [!${type}]${open ? "+" : "-"} ${head}`, ...lines.map((l) => `> - ${l}`)].join("\n");
}

function render(input) {
  const d = {
    brief: {
      repos: { ship: [], resync: [], stale: [], dirty: [], ...(input.brief || {}).repos },
      vault: { docs_to_review: 0, docs_to_review_top: [], inbox: 0, recent_changes: 0, ...(input.brief || {}).vault },
      backlog: { open: 0, stale: 0, ...(input.brief || {}).backlog },
      writeups: { drafts: [], ...(input.brief || {}).writeups },
    },
    board: input.board || { tasks: [] },
  };

  const blocks = [`> [!note] ${isoDate}\n> ${summaryLine(d.brief)}`];
  for (const s of SECTIONS) {
    const lines = s.lines(d).filter(Boolean);
    if (!lines.length) continue; // drop empty sections — keep the note focused
    blocks.push(callout(s.title, s.callout, s.open, lines, s.count && s.count(d)));
  }
  return blocks.join("\n\n");
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
  process.stdout.write(render(input) + "\n");
});
