#!/usr/bin/env node
// brief/render.mjs — digest + render for `brief`.
//
// Reads one JSON object on stdin ({ repos, vault, writeups, prs }) produced by
// the emitters bin/brief aggregates, reduces it to a high-signal digest, and
// emits either the digest JSON (mode "json") or a human briefing (mode "human").
// Emit-once, render-many: one digest, two renderers.

const mode = process.argv[2] === "json" ? "json" : "human";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { input = {}; }

  const repos = input.repos || {};
  const vault = input.vault || {};
  const writeups = input.writeups || {};
  const prs = Array.isArray(input.prs) ? input.prs : null;

  const repoList = Array.isArray(repos.repos) ? repos.repos : [];
  const dirty = repoList.filter((r) => (r.dirty || 0) + (r.untracked || 0) > 0).map((r) => r.name);
  const unpushed = repoList
    .filter((r) => !r.has_remote || (r.ahead || 0) > 0 || (r.has_remote && !r.upstream))
    .map((r) => r.name);
  const byPm = {};
  for (const r of repoList) byPm[r.pm] = (byPm[r.pm] || 0) + 1;

  const wlist = Array.isArray(writeups.writeups) ? writeups.writeups : [];
  const drafts = wlist.filter((w) => !w.published).map((w) => w.slug);
  const published = wlist.filter((w) => w.published).length;
  const featured = (writeups.featured_order || []).map((f) => f.slug);

  const review = vault.docs_to_review || {};
  const reviewDocs = Array.isArray(review.docs) ? review.docs : [];

  const digest = {
    ok: true,
    repos: { count: repoList.length, dirty, unpushed, by_pm: byPm },
    vault: {
      doc_count: vault.vault_doc_count || 0,
      recent_changes: (vault.recent_changes || {}).count || 0,
      docs_to_review: review.count || 0,
      docs_to_review_top: reviewDocs.slice(0, 5).map((d) => d.doc_id),
      inbox: (vault.inbox || {}).count || 0,
    },
    writeups: { drafts, published, featured },
  };
  if (prs) digest.prs = prs;

  if (mode === "json") {
    process.stdout.write(JSON.stringify(digest));
    return;
  }

  // ---- human briefing ----
  const B = "\x1b[1m", D = "\x1b[2m", Y = "\x1b[33m", R = "\x1b[0m";
  const out = [];
  const head = (s) => out.push(`\n  ${B}${s}${R}`);
  const line = (label, val, warn = false) =>
    out.push(`  ${D}${label.padEnd(14)}${R}${warn ? Y : ""}${val}${R}`);

  head("repos");
  line("total", String(digest.repos.count));
  line("dirty", dirty.length ? dirty.join(", ") : "none", dirty.length > 0);
  line("unpushed", unpushed.length ? unpushed.join(", ") : "none", unpushed.length > 0);
  line("by pm", Object.entries(byPm).map(([k, v]) => `${k} ${v}`).join("  "));

  head("vault");
  line("docs", String(digest.vault.doc_count));
  line(`changed ${(vault.recent_changes || {}).days || 7}d`, String(digest.vault.recent_changes));
  line("to review", digest.vault.docs_to_review
    ? `${digest.vault.docs_to_review}  (${digest.vault.docs_to_review_top.join(", ")})`
    : "none", digest.vault.docs_to_review > 0);
  line("inbox", String(digest.vault.inbox), digest.vault.inbox > 0);

  head("writeups");
  line("published", String(published));
  line("drafts", drafts.length ? drafts.join(", ") : "none", drafts.length > 0);
  line("featured", featured.length ? featured.join(" > ") : "none");

  if (prs) {
    head("open PRs");
    if (!prs.length) line("none", "");
    for (const p of prs) {
      for (const pr of p.prs || []) line(p.repo, `#${pr.number} ${pr.title}`);
    }
  }

  out.push("");
  process.stdout.write(out.join("\n") + "\n");
});
