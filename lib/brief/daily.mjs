#!/usr/bin/env node
// brief/daily.mjs — render the daily note's region as a log of what you DID that
// day: commits across the fleet + work shipped (tasks closed). A daily note is
// retrospective — the cockpit shows pending work; this shows the record.
//
// PURE: reads an activity object on stdin and emits markdown. The git/closed
// gathering lives in daily-gather.mjs (the impure fold), so this stays testable.
//   stdin: { commits: [{repo, subjects:[...]}], closed: [{doc_id, title, project}] }
//   argv[2]: ISO date for the header.
//
// SECTIONS is the single declarative list — add a kind of "what I did" by editing
// one entry. Empty sections drop, so a quiet day is just the header (you write
// the rest below the region by hand).

const isoDate = process.argv[2] || new Date().toISOString().slice(0, 10);

const SECTIONS = [
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

function summaryLine(a) {
  const commits = a.commits.reduce((n, r) => n + r.subjects.length, 0);
  const parts = [];
  if (commits) parts.push(`${commits} commit${commits === 1 ? "" : "s"}`);
  if (a.closed.length) parts.push(`${a.closed.length} shipped`);
  return parts.length ? parts.join(" · ") : "nothing recorded yet — log it below";
}

function callout(title, type, open, lines) {
  return [`> [!${type}]${open ? "+" : "-"} ${title}`, ...lines.map((l) => `> - ${l}`)].join("\n");
}

function render(input) {
  const a = {
    commits: Array.isArray(input.commits) ? input.commits : [],
    closed: Array.isArray(input.closed) ? input.closed : [],
  };
  const blocks = [`> [!note] ${isoDate}\n> ${summaryLine(a)}`];
  for (const s of SECTIONS) {
    const lines = s.lines(a).filter(Boolean);
    if (!lines.length) continue;
    blocks.push(callout(s.title, s.callout, s.open, lines));
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
