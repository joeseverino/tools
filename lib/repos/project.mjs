#!/usr/bin/env node
// repos/project.mjs — the one reader for a `repos --json` payload on stdin.
//
// A driver passes a row function: (repo) => an array of cells for one TSV line,
// or null/undefined to drop that repo. The stdin plumbing and the "parse repos
// --json, fall back to empty on garbage" guard live here once, so ship / land /
// resync each declare only their own filter and columns — never a second copy of
// the read loop. The read-side sibling of lib/git.sh owning the write mechanics:
// `repos` is the one read owner, and this is the one way to consume it.

export function projectReposStdin(rowFn) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const repos = Array.isArray(parsed.repos) ? parsed.repos : [];
    const lines = [];
    for (const repo of repos) {
      const cells = rowFn(repo);
      if (cells) lines.push(cells.join("\t"));
    }
    process.stdout.write(lines.length ? lines.join("\n") + "\n" : "");
  });
}
