#!/usr/bin/env node
// brief/remotes.mjs — read a `repos --json` payload on stdin, emit one
// "<name>\t<path>" line per repo that has a remote (the --prs candidates).
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (s += c));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(s); } catch { d = {}; }
  for (const r of d.repos || []) {
    if (r.has_remote) process.stdout.write(`${r.name}\t${r.path}\n`);
  }
});
