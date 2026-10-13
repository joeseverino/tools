#!/usr/bin/env node
// brief/render.ts — digest + render for `brief`.
//
// Reads one JSON object on stdin ({ repos, vault, writeups }) produced by the
// emitters bin/brief aggregates, reduces it to a high-signal digest, and emits
// either the digest JSON (mode "json") or a human briefing (mode "human").
// Emit-once, render-many: one digest, two renderers.
//
// Open-PR/CI state is read from each repo's `pr` field (present only when brief
// ran `repos --prs`), so repos is the one PR owner. The second positional is the
// --prs flag ("1"/"0"): it gates the PR section so it shows even at zero.

import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { runCli } from '../sdk/cli.ts';
import { paint } from '../sdk/color.ts';
import { isRecord, isStringArray, parseJson } from '../sdk/guards.ts';
import type { JsonRecord } from '../sdk/guards.ts';

interface Pr { state: string; number: number; ci: string; review: string; url: string }
interface Repo {
  name: string;
  pm: string;
  needs_ship?: boolean;
  needs_resync?: boolean;
  needs_attention?: boolean;
  branch_state?: string;
  dirty?: number;
  untracked?: number;
  pr?: Pr;
}
interface Writeup { slug: string; published?: boolean }
interface Line { label?: string; value?: unknown; warn?: boolean }
interface Section { name: string; lines?: Line[]; next?: Line[] }
interface PrRow { repo: string; number: number; ci: string; review: string; url: string }

interface Digest {
  ok: boolean;
  repos: { count: number; ship: string[]; resync: string[]; stale: string[]; dirty: string[]; attention: number; by_pm: Record<string, number> };
  vault: { doc_count: number; recent_changes: number; docs_to_review: number; docs_to_review_top: string[]; inbox: number };
  backlog: { open: number; total: number; stale: number; stale_slugs: string[] };
  writeups: { drafts: string[]; published: number; featured: string[] };
  prs?: PrRow[];
  sections?: Section[];
}

const optional = (value: unknown, type: 'string' | 'number' | 'boolean'): boolean =>
  value === undefined || typeof value === type;

function isPr(value: unknown): value is Pr {
  return isRecord(value)
    && typeof value['state'] === 'string'
    && typeof value['number'] === 'number'
    && typeof value['ci'] === 'string'
    && typeof value['review'] === 'string'
    && typeof value['url'] === 'string';
}

function isRepo(value: unknown): value is Repo {
  return isRecord(value)
    && typeof value['name'] === 'string'
    && typeof value['pm'] === 'string'
    && optional(value['needs_ship'], 'boolean')
    && optional(value['needs_resync'], 'boolean')
    && optional(value['needs_attention'], 'boolean')
    && optional(value['branch_state'], 'string')
    && optional(value['dirty'], 'number')
    && optional(value['untracked'], 'number')
    && (value['pr'] === undefined || isPr(value['pr']));
}

function isWriteup(value: unknown): value is Writeup {
  return isRecord(value) && typeof value['slug'] === 'string' && optional(value['published'], 'boolean');
}

function isLine(value: unknown): value is Line {
  return isRecord(value);
}

function isSection(value: unknown): value is Section {
  return isRecord(value)
    && typeof value['name'] === 'string' && value['name'] !== ''
    && (value['lines'] === undefined || (Array.isArray(value['lines']) && value['lines'].every(isLine)))
    && (value['next'] === undefined || (Array.isArray(value['next']) && value['next'].every(isLine)));
}

function record(value: unknown, key: string): JsonRecord {
  const field = isRecord(value) ? value[key] : undefined;
  return isRecord(field) ? field : {};
}

function list<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

function count(value: JsonRecord, key: string): number {
  const field = value[key];
  return typeof field === 'number' ? field : 0;
}

function digestFrom(input: unknown, sections: Section[], prsRequested: boolean): { digest: Digest; repoList: Repo[]; greenPrs: (Repo & { pr: Pr })[]; recentDays: number } {
  const repoList = list(record(input, 'repos')['repos'], isRepo);
  const vault = record(input, 'vault');
  const writeups = record(input, 'writeups');

  // needs_ship, needs_resync, needs_attention and branch_state are repos' own
  // classification; consume them, never re-derive.
  const ship = repoList.filter((r) => r.needs_ship).map((r) => r.name);
  const resync = repoList.filter((r) => r.needs_resync).map((r) => r.name);
  const stale = repoList.filter((r) => r.branch_state === 'stale').map((r) => r.name);
  const openPrs = repoList.filter((r): r is Repo & { pr: Pr } => r.pr?.state === 'open');
  const greenPrs = openPrs.filter((r) => r.pr.ci === 'passing' || r.pr.ci === 'none');
  const dirty = repoList.filter((r) => (r.dirty || 0) + (r.untracked || 0) > 0).map((r) => r.name);
  const byPm: Record<string, number> = {};
  for (const r of repoList) byPm[r.pm] = (byPm[r.pm] || 0) + 1;

  const wlist = list(writeups['writeups'], isWriteup);
  const featured = list(writeups['featured_order'], isWriteup).map((f) => f.slug);

  const review = record(vault, 'docs_to_review');
  const reviewDocs = list(review['docs'], (d): d is { doc_id: string } => isRecord(d) && typeof d['doc_id'] === 'string');
  const tasks = record(vault, 'tasks');
  const staleSlugs = tasks['stale_slugs'];

  const digest: Digest = {
    ok: true,
    repos: { count: repoList.length, ship, resync, stale, dirty, attention: repoList.filter((r) => r.needs_attention).length, by_pm: byPm },
    vault: {
      doc_count: count(vault, 'vault_doc_count'),
      recent_changes: count(record(vault, 'recent_changes'), 'count'),
      docs_to_review: count(review, 'count'),
      docs_to_review_top: reviewDocs.slice(0, 5).map((d) => d.doc_id),
      inbox: count(record(vault, 'inbox'), 'count'),
    },
    backlog: {
      open: count(tasks, 'open'),
      total: count(tasks, 'total'),
      stale: count(tasks, 'stale'),
      stale_slugs: isStringArray(staleSlugs) ? staleSlugs : [],
    },
    writeups: {
      drafts: wlist.filter((w) => !w.published).map((w) => w.slug),
      published: wlist.filter((w) => w.published).length,
      featured,
    },
  };
  if (prsRequested) {
    digest.prs = openPrs.map((r) => ({ repo: r.name, number: r.pr.number, ci: r.pr.ci, review: r.pr.review, url: r.pr.url }));
  }
  if (sections.length) digest.sections = sections;
  return { digest, repoList, greenPrs, recentDays: count(record(vault, 'recent_changes'), 'days') || 7 };
}

function human(digest: Digest, greenPrs: (Repo & { pr: Pr })[], recentDays: number): string {
  const { ship, resync, stale, dirty, by_pm: byPm } = digest.repos;
  const sections = digest.sections ?? [];
  const { drafts, published, featured } = digest.writeups;
  const prs = digest.prs;
  const out: string[] = [];
  const head = (s: string) => out.push(`\n  ${paint('bold', s)}`);
  const line = (label: string, val: string, warn = false) =>
    out.push(`  ${paint('dim', label.padEnd(14))}${warn ? paint('yellow', val) : val}`);

  head('repos');
  line('total', String(digest.repos.count));
  line('ship', ship.length ? ship.join(', ') : 'none', ship.length > 0);
  line('resync', resync.length ? resync.join(', ') : 'none', resync.length > 0);
  if (stale.length) line('stale', stale.join(', '), true);
  line('dirty', dirty.length ? dirty.join(', ') : 'none', dirty.length > 0);
  line('by pm', Object.entries(byPm).map(([k, v]) => `${k} ${v}`).join('  '));

  head('vault');
  line('docs', String(digest.vault.doc_count));
  line(`changed ${recentDays}d`, String(digest.vault.recent_changes));
  line('to review', digest.vault.docs_to_review
    ? `${digest.vault.docs_to_review}  (${digest.vault.docs_to_review_top.join(', ')})`
    : 'none', digest.vault.docs_to_review > 0);
  line('inbox', String(digest.vault.inbox), digest.vault.inbox > 0);

  head('backlog');
  line('open', String(digest.backlog.open));
  line('stale', digest.backlog.stale
    ? `${digest.backlog.stale}  (${digest.backlog.stale_slugs.join(', ')})`
    : 'none', digest.backlog.stale > 0);

  for (const s of sections) {
    head(s.name);
    for (const l of s.lines || []) line(l.label || '', String(l.value ?? ''), !!l.warn);
  }

  head('writeups');
  line('published', String(published));
  line('drafts', drafts.length ? drafts.join(', ') : 'none', drafts.length > 0);
  line('featured', featured.length ? featured.join(' > ') : 'none');

  if (prs) {
    head('open PRs');
    if (!prs.length) line('none', '');
    for (const pr of prs) {
      const flag = pr.ci === 'failing' ? '✗' : pr.ci === 'pending' ? '•' : '✓';
      line(pr.repo, `#${pr.number} ${flag} ${pr.ci} · ${pr.review}`, pr.ci !== 'passing');
    }
  }

  const sectionNext = sections.flatMap((s) => s.next || []);
  if (ship.length || greenPrs.length || resync.length || stale.length || digest.backlog.stale || sectionNext.length) {
    head('next');
    for (const n of sectionNext) line(n.label || '', String(n.value ?? ''));
    if (stale.length) {
      line('rebranch', stale.length === 1
        ? `ship ${stale[0]} --rebranch --go   (stale branch off old main)`
        : `ship <name> --rebranch --go   (${stale.length} stale)`);
    }
    if (ship.length) {
      line('ship', ship.length === 1
        ? `ship ${ship[0]} --check --watch --go`
        : `ship <name> --check --watch --go   (${ship.length} pending)`);
    }
    if (greenPrs.length) {
      line('land', greenPrs.length === 1
        ? `land ${greenPrs[0]?.name} --go`
        : `land <name> --go   (${greenPrs.length} green)`);
    }
    if (resync.length) line('resync', 'resync');
    if (digest.backlog.stale) line('review', `backlog stale   (${digest.backlog.stale} untouched)`);
    line('explore', 'repos tui');
  }

  out.push('');
  return out.join('\n') + '\n';
}

await runCli(async () => {
  const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });
  const mode = positionals[0] === 'json' ? 'json' : 'human';
  const prsRequested = positionals[1] === '1';

  const input = parseJson(await text(process.stdin));
  // Plugged sections ride through untouched: the emitter owns their content.
  const sections = list(isRecord(input) ? input['sections'] : undefined, isSection);
  const { digest, greenPrs, recentDays } = digestFrom(input, sections, prsRequested);
  process.stdout.write(mode === 'json' ? JSON.stringify(digest) : human(digest, greenPrs, recentDays));
});
