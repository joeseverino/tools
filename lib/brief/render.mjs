#!/usr/bin/env node
// brief/render.mjs — digest + render for `brief`.
//
// Reads one JSON object on stdin ({ repos, vault, writeups }) produced by the
// emitters bin/brief aggregates, reduces it to a high-signal digest, and emits
// either the digest JSON (mode "json") or a human briefing (mode "human").
// Emit-once, render-many: one digest, two renderers.
//
// Open-PR/CI state is read straight off each repo's `pr` field (present only when
// brief ran `repos --prs`) — brief no longer carries a parallel `prs` array, so
// there is one PR owner (repos), not two. argv[3] is the --prs flag ("1"/"0"): it
// gates the PR section and the land "next" verb so they show even at zero.

const mode = process.argv[2] === "json" ? "json" : "human";
const prsRequested = process.argv[3] === "1";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { input = {}; }

  const repos = input.repos || {};
  const vault = input.vault || {};
  const writeups = input.writeups || {};

  const repoList = Array.isArray(repos.repos) ? repos.repos : [];
  // Consume repos' owned classification (needs_ship / needs_resync /
  // needs_attention) — bin/repos is the one owner; never re-derive it here.
  const ship = repoList.filter((r) => r.needs_ship).map((r) => r.name);
  const resync = repoList.filter((r) => r.needs_resync).map((r) => r.name);
  // Open PRs and the green ones to land, straight off repos --prs (one owner).
  const openPrs = repoList.filter((r) => r.pr && r.pr.state === "open");
  const greenPrs = openPrs.filter((r) => r.pr.ci === "passing" || r.pr.ci === "none");
  const prs = prsRequested
    ? openPrs.map((r) => ({ repo: r.name, number: r.pr.number, ci: r.pr.ci, review: r.pr.review, url: r.pr.url }))
    : null;
  const dirty = repoList.filter((r) => (r.dirty || 0) + (r.untracked || 0) > 0).map((r) => r.name);
  const attention = repoList.filter((r) => r.needs_attention).length;
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
    repos: { count: repoList.length, ship, resync, dirty, attention, by_pm: byPm },
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
  line("ship", ship.length ? ship.join(", ") : "none", ship.length > 0);
  line("resync", resync.length ? resync.join(", ") : "none", resync.length > 0);
  line("dirty", dirty.length ? dirty.join(", ") : "none", dirty.length > 0);
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
    for (const pr of prs) {
      const flag = pr.ci === "failing" ? "✗" : pr.ci === "pending" ? "•" : "✓";
      line(pr.repo, `#${pr.number} ${flag} ${pr.ci} · ${pr.review}`, pr.ci !== "passing");
    }
  }

  // Close the loop: name the next workflow verbs from the same classification,
  // in loop order — ship (dirty) → land (green PR) → resync (merged).
  if (ship.length || greenPrs.length || resync.length) {
    head("next");
    if (ship.length) {
      line("ship", ship.length === 1
        ? `ship ${ship[0]} --check --watch --go`
        : `ship <name> --check --watch --go   (${ship.length} pending)`);
    }
    if (greenPrs.length) {
      line("land", greenPrs.length === 1
        ? `land ${greenPrs[0].name} --go`
        : `land <name> --go   (${greenPrs.length} green)`);
    }
    if (resync.length) line("resync", "resync");
    line("explore", "repos tui");
  }

  out.push("");
  process.stdout.write(out.join("\n") + "\n");
});
