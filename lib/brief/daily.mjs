#!/usr/bin/env node
// brief/daily.mjs — render `brief --json` into the daily note's brief region as
// native Obsidian callouts. One renderer, consumed by `vault daily` (and, via
// shelling that, the Obsidian plugin), so the CLI and the plugin can never drift.
//
// Emits the region BODY only — the MIRROR markers are owned by the MCP's
// `daily-write` verb, which replaces the region in place and never touches the
// free-capture area below it. Consumes the one brief digest (bin/brief is the
// aggregator); it re-derives nothing.
//
// SECTIONS is the single, declarative list: a section is {title, callout, open,
// lines(digest) -> string[], count?(digest)}. Add or reorder a section by
// editing one entry — empty sections are dropped, so the note stays terse.
//
// argv[2] = ISO date for the header (the note's date).

const isoDate = process.argv[2] || new Date().toISOString().slice(0, 10);

// A callout line list, collapsed when long and low-urgency. `open` → "+"
// (expanded) vs "-" (folded). Obsidian callout types are stable identifiers.
const SECTIONS = [
  {
    title: "Workspace",
    callout: "todo",
    open: true,
    lines: (d) => [
      ...d.repos.ship.map((n) => `\`ship ${n} --check --watch --go\``),
      ...d.repos.stale.map((n) => `\`ship ${n} --rebranch --go\` — stale branch`),
      ...d.repos.resync.map((n) => `\`resync ${n}\` — merged, reconcile`),
    ],
  },
  {
    title: "Docs to review",
    callout: "info",
    open: true,
    count: (d) => d.vault.docs_to_review,
    lines: (d) => d.vault.docs_to_review_top.map((id) => `[[${id}]]`),
  },
  {
    title: "Stale backlog",
    callout: "warning",
    open: false,
    count: (d) => d.backlog.stale,
    lines: (d) => d.backlog.stale_slugs.map((s) => `[[${s}]]`),
  },
  {
    title: "Writeup drafts",
    callout: "abstract",
    open: false,
    lines: (d) => d.writeups.drafts.map((s) => `[[${s}]]`),
  },
];

function summaryLine(d) {
  const parts = [];
  if (d.vault.docs_to_review) parts.push(`${d.vault.docs_to_review} to review`);
  if (d.backlog.stale) parts.push(`${d.backlog.stale} stale`);
  if (d.backlog.open) parts.push(`${d.backlog.open} open tasks`);
  if (d.vault.inbox) parts.push(`inbox ${d.vault.inbox}`);
  if (d.vault.recent_changes) parts.push(`${d.vault.recent_changes} changed (7d)`);
  return parts.length ? parts.join(" · ") : "all clear";
}

function renderCallout(title, callout, open, bodyLines, count) {
  const fold = open ? "+" : "-";
  const head = count ? `${title} (${count})` : title;
  return [`> [!${callout}]${fold} ${head}`, ...bodyLines.map((l) => `> - ${l}`)];
}

function render(digest) {
  const d = {
    repos: digest.repos || { ship: [], resync: [], stale: [], dirty: [] },
    vault: digest.vault || { docs_to_review: 0, docs_to_review_top: [], inbox: 0, recent_changes: 0 },
    backlog: digest.backlog || { open: 0, stale: 0, stale_slugs: [] },
    writeups: digest.writeups || { drafts: [] },
  };

  const blocks = [[`> [!note] ${isoDate}`, `> ${summaryLine(d)}`].join("\n")];
  for (const s of SECTIONS) {
    const lines = s.lines(d).filter(Boolean);
    if (!lines.length) continue; // drop empty sections — keep the note terse
    blocks.push(renderCallout(s.title, s.callout, s.open, lines, s.count && s.count(d)).join("\n"));
  }
  return blocks.join("\n\n");
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let digest = {};
  try {
    digest = JSON.parse(raw);
  } catch {
    digest = {};
  }
  process.stdout.write(render(digest) + "\n");
});
