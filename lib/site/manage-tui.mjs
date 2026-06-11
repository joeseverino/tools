#!/usr/bin/env node
// site manage — one screen for the whole writeup surface: reorder the
// featured list, feature/unfeature, publish/unpublish, scaffold a new
// writeup, and edit a writeup's frontmatter fields. Changes are staged
// locally and only written on save, through the severino-vault-mcp CLI, so
// every frontmatter write shares the MCP tools' code path and guarantees
// (sequential 1..N featured order, format-preserving YAML edits).

import { spawnSync, spawn, execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const MCP_BIN = 'severino-vault-mcp';
const TOOLS_HOME = process.env.TOOLS_HOME || '';
const SITE_BIN = TOOLS_HOME ? `${TOOLS_HOME}/bin/site` : 'site';
const CODE_HOME = process.env.CODE_HOME || `${process.env.HOME}/Documents/Code`;
const SITE_HOME = process.env.SITE_HOME || `${CODE_HOME}/Projects/jseverino.com`;
// Same defaults and overrides as bin/site (cmd_dev / cmd_compare).
const DEV_PORT = process.env.SITE_DEV_PORT || '4321';
const COMPARE_PORT = process.env.SITE_COMPARE_PORT || '4178';
const LIVE_URL = process.env.SITE_LIVE_URL || 'https://jseverino.com';
// MANAGE_TUI_KEYS replays a comma-separated key script through the real
// handler without a TTY and prints only the final frame — the interaction
// counterpart to MANAGE_TUI_SMOKE's static renders. Used by tests/site-manage.bats.
const REPLAY = !!process.env.MANAGE_TUI_KEYS;

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const INVERT = '\x1b[7m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function mcp(args) {
  const res = spawnSync(MCP_BIN, args, { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(res.stdout || 'null');
  } catch {
    json = null;
  }
  const ok = res.status === 0 && json !== null && json.ok !== false;
  return { ok, json, stderr: (res.stderr || '').trim() };
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

// ---- model ------------------------------------------------------------------

function toItem(w) {
  return {
    slug: w.slug,
    title: w.title || w.slug,
    description: w.description || '',
    published: !!w.published,
    publishedAt: w.published_at || '',
    lastReviewed: w.last_reviewed || '',
    coverImage: w.cover_image || '',
    coverAlt: w.cover_alt || '',
    technologies: w.technologies || [],
    relatedProjects: w.related_projects || [],
    relatedAssets: w.related_assets || [],
    edits: {},
  };
}

function adjustedIssues(v, published) {
  // Drafts are expected to have the published/published_at blockers; only
  // surface what would still block after checking the box.
  let blockers = v.blockers || [];
  if (!published) blockers = blockers.filter((b) => !/^published is false|^published_at empty/.test(b));
  return [
    ...blockers,
    ...(v.missing_tech_slugs || []).map((s) => 'missing tech slug: ' + s),
    ...(v.missing_images || []).map((s) => 'missing image: ' + s),
  ];
}

function isPortOpen(port) {
  try {
    execSync(`lsof -t -i tcp:${port}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function loadSiteStatus() {
  const status = {
    devServerOpen: isPortOpen(DEV_PORT),
    compareOpen: isPortOpen(COMPARE_PORT),
    gitBranch: 'unknown',
    gitChanges: 0,
    gitAheadBehind: '',
    commitHash: '',
    commitSubject: '',
    commitAge: '',
    distStatus: 'unknown',
    securityStatus: 'unknown',
    liveCode: '',
    loadedAt: new Date().toTimeString().slice(0, 8),
  };

  try {
    status.gitBranch = execSync(`git -C "${SITE_HOME}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const gitStatus = execSync(`git -C "${SITE_HOME}" status --porcelain`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    status.gitChanges = gitStatus ? gitStatus.split('\n').length : 0;
  } catch {}

  try {
    const line = execSync(`git -C "${SITE_HOME}" log -1 --format=%h%x09%s%x09%cr`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    [status.commitHash, status.commitSubject, status.commitAge] = line.split('\t');
  } catch {}

  try {
    const ab = execSync(`git -C "${SITE_HOME}" rev-list --left-right --count HEAD...@{u}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const parts = ab.split(/\s+/);
    if (parts.length === 2) {
      status.gitAheadBehind = `${parts[0]} ahead, ${parts[1]} behind`;
    }
  } catch {
    status.gitAheadBehind = 'no upstream';
  }

  let distPath = null;
  if (existsSync(`${SITE_HOME}/dist.nosync`)) {
    distPath = `${SITE_HOME}/dist.nosync`;
  } else if (existsSync(`${SITE_HOME}/dist`)) {
    distPath = `${SITE_HOME}/dist`;
  }

  if (distPath) {
    try {
      const stats = statSync(distPath);
      const mtime = stats.mtime.toISOString().slice(0, 16).replace('T', ' ');
      status.distStatus = `Present (built ${mtime})`;
    } catch {
      status.distStatus = 'Present';
    }
  } else {
    status.distStatus = 'not built';
  }

  try {
    const output = execSync(`"${SITE_BIN}" check-security`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const lines = output.split('\n');
    status.securityStatus = lines[lines.length - 1].replace(/^ok\s+/, '').trim();
  } catch {
    status.securityStatus = 'signature invalid or missing';
  }

  try {
    status.liveCode = execSync(`curl -s -o /dev/null -m 2 -w '%{http_code}' "${LIVE_URL}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    status.liveCode = '';
  }

  return status;
}

function load() {
  const res = mcp(['list-writeups', '--filter', 'all']);
  if (!res.ok) fail('could not load writeups: ' + (res.stderr || 'is severino-vault-mcp on PATH?'));
  const summaries = res.json.writeups || [];
  const featured = summaries
    .filter((w) => w.featured)
    .sort(
      (a, b) =>
        (a.featured_order ?? 1e9) - (b.featured_order ?? 1e9) || a.slug.localeCompare(b.slug),
    );
  const rest = summaries
    .filter((w) => !w.featured)
    .sort((a, b) => Number(b.published) - Number(a.published) || a.slug.localeCompare(b.slug));
  const items = [...featured, ...rest].map(toItem);

  // One gate pass up front so every row can show its publish-readiness.
  const gate = mcp(['validate-all-writeups', '--include-drafts']);
  const issues = new Map();
  const nits = new Map();
  for (const v of (gate.json && gate.json.writeups) || []) {
    const published = !!summaries.find((s) => s.slug === v.slug)?.published;
    issues.set(v.slug, adjustedIssues(v, published));
    nits.set(v.slug, v.nits || []);
  }

  return {
    items,
    divider: featured.length,
    cursor: 0,
    tab: 'writeups',
    mode: 'list', // list | move | detail | edit | new | confirm-quit
    field: 0, // detail-view field cursor
    input: '', // line-editor buffer (edit + new modes)
    flash: '',
    created: [], // slugs scaffolded this session (already on disk)
    issues,
    nits,
    origFeatured: featured.map((w) => w.slug),
    origPublished: new Map(items.map((i) => [i.slug, i.published])),
    siteStatus: null,
    actionCursor: 0,
  };
}

function reload(model) {
  const oldCursor = model.cursor;
  const oldMode = model.mode;
  const oldTab = model.tab;
  const oldActionCursor = model.actionCursor;
  const next = load();
  Object.assign(model, next);
  model.cursor = Math.min(model.items.length, oldCursor);
  model.mode = oldMode === 'confirm-reload' ? 'list' : oldMode;
  model.tab = oldTab;
  model.actionCursor = oldActionCursor;
  if (oldTab === 'site') model.siteStatus = loadSiteStatus();
  model.flash = `${GREEN}reloaded writeups and validation status from disk${RESET}`;
}

function drawTabBar(model) {
  const writeupsActive = model.tab === 'writeups';
  const siteActive = model.tab === 'site';
  const writeupsLabel = `  Writeups (${model.items.length})  `;

  const writeupsTab = writeupsActive
    ? `${BOLD}${INVERT}${writeupsLabel}${RESET}`
    : `${DIM}${writeupsLabel}${RESET}`;

  const siteTab = siteActive
    ? `${BOLD}${INVERT}  Site  ${RESET}`
    : `${DIM}  Site  ${RESET}`;

  return `  ${writeupsTab}  ${siteTab}`;
}

// Status gathering shells out (git, check-security, curl) and takes ~1s, so
// the Site tab keeps the first result and only regathers on r / Ctrl+R or
// after an action; the "as of" timestamp shows how stale it is.
function gatherSiteStatus(model) {
  const cols = process.stdout.columns || 110;
  if (!REPLAY) {
    process.stdout.write(
      '\x1b[2J\x1b[H\n' + drawTabBar(model) + '\n' +
      `  ${'─'.repeat(Math.max(40, cols - 4))}\n\n` +
      `  ${DIM}gathering site status…${RESET}\n`,
    );
  }
  const t0 = Date.now();
  model.siteStatus = loadSiteStatus();
  return ((Date.now() - t0) / 1000).toFixed(1);
}

function switchTab(model, tab) {
  model.tab = tab;
  model.flash = '';
  if (tab === 'site' && !model.siteStatus) gatherSiteStatus(model);
}

function toggleDevServer(model) {
  const open = isPortOpen(DEV_PORT);
  if (open) {
    model.flash = `${YELLOW}stopping dev server...${RESET}`;
    draw(model);
    spawnSync('sh', ['-c', `lsof -t -i tcp:${DEV_PORT} | xargs kill -9`], { stdio: 'ignore' });
    model.siteStatus = loadSiteStatus();
    model.flash = `${GREEN}dev server stopped${RESET}`;
  } else {
    model.flash = `${YELLOW}starting dev server...${RESET}`;
    draw(model);
    const child = spawn(SITE_BIN, ['dev'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin` }
    });
    child.unref();

    let started = false;
    for (let i = 0; i < 20; i++) {
      if (isPortOpen(DEV_PORT)) {
        started = true;
        break;
      }
      spawnSync('sleep', ['0.1']);
    }

    model.siteStatus = loadSiteStatus();
    if (started) {
      model.flash = `${GREEN}dev server started on http://127.0.0.1:${DEV_PORT}${RESET}`;
    } else {
      model.flash = `${RED}dev server failed to start (check port ${DEV_PORT} manually)${RESET}`;
    }
  }
}

function toggleCompareServer(model) {
  const open = isPortOpen(COMPARE_PORT);
  if (open) {
    model.flash = `${YELLOW}stopping SiteDrift...${RESET}`;
    draw(model);
    spawnSync('sh', ['-c', `lsof -t -i tcp:${COMPARE_PORT} | xargs kill -9`], { stdio: 'ignore' });
    spawnSync('launchctl', ['remove', `com.severino.site-compare.${COMPARE_PORT}`], { stdio: 'ignore' });
    model.siteStatus = loadSiteStatus();
    model.flash = `${GREEN}SiteDrift stopped${RESET}`;
  } else {
    model.flash = `${YELLOW}launching SiteDrift compare viewer...${RESET}`;
    draw(model);
    const child = spawn(SITE_BIN, ['compare'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin` }
    });
    child.unref();

    let started = false;
    for (let i = 0; i < 30; i++) {
      if (isPortOpen(COMPARE_PORT)) {
        started = true;
        break;
      }
      spawnSync('sleep', ['0.1']);
    }

    model.siteStatus = loadSiteStatus();
    if (started) {
      model.flash = `${GREEN}SiteDrift started on https://compare.homelab:${COMPARE_PORT}${RESET}`;
    } else {
      model.flash = `${RED}SiteDrift failed to start (check cert-gen compare.homelab)${RESET}`;
    }
  }
}

function runCommandInline(bin, args, title) {
  if (!process.stdin.isTTY) return; // replay scripts never run real commands
  setTitle(`site manage — ${title}`);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write('\x1b[?25h\x1b[?1049l'); // Show cursor, leave alt screen

  process.stdout.write(`\n=== ${BOLD}${title}${RESET} ===\n\n`);

  const res = spawnSync(bin, args, {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin` }
  });

  process.stdout.write('\n─────────────────────────────────────────────────────────────────────────────\n');
  process.stdout.write(`Finished with exit code ${res.status}. Press any key to return...`);

  // Node keeps the TTY fd non-blocking, so fs.readSync(0, …) EAGAINs straight
  // through "press any key"; block in a child that owns the terminal instead.
  spawnSync('bash', ['-c', 'read -rsn1'], { stdio: 'inherit' });

  process.stdout.write('\x1b[?1049h\x1b[?25l'); // Alt screen, hide cursor
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function runHealthCheck(model) {
  runCommandInline(SITE_BIN, ['doctor'], 'Site Pre-flight Health Check (site doctor)');
  model.siteStatus = loadSiteStatus();
}

function runPublish(model) {
  runCommandInline(SITE_BIN, ['publish'], 'Publishing Site (site publish)');
  reload(model);
}

function runDiagnose(model) {
  runCommandInline(SITE_BIN, ['diagnose'], 'Full Diagnostic Gate (site diagnose)');
  model.siteStatus = loadSiteStatus();
}

function runBuild(model) {
  runCommandInline(SITE_BIN, ['build'], 'Astro Build (site build)');
  model.siteStatus = loadSiteStatus();
}

function runTests(model) {
  runCommandInline(SITE_BIN, ['test'], 'Playwright Suite (site test)');
  model.siteStatus = loadSiteStatus();
}

function siteActions(status) {
  return [
    { key: 'd', label: status.devServerOpen ? 'Stop Dev Server' : 'Start Dev Server', desc: `starts/stops Astro at port ${DEV_PORT}`, run: toggleDevServer },
    { key: 'c', label: status.compareOpen ? 'Stop SiteDrift' : 'Launch SiteDrift', desc: `starts/stops compare viewer at port ${COMPARE_PORT}`, run: toggleCompareServer },
    { key: 'h', label: 'Run Health Check', desc: 'pre-flight doctor checks, no build', run: runHealthCheck },
    { key: 'g', label: 'Run Diagnose', desc: 'the collect-all gate: every audit in one pass', run: runDiagnose },
    { key: 'b', label: 'Build Site', desc: 'full Astro build into dist', run: runBuild },
    { key: 't', label: 'Run Tests', desc: 'Playwright suite (site test)', run: runTests },
    { key: 'p', label: 'Publish Site', desc: 'doctor + build + commit + push + live verify', run: runPublish },
  ];
}

const FIELDS = [
  { key: 'title', label: 'title', flag: '--title', editable: true },
  { key: 'description', label: 'description', flag: '--description', editable: true },
  { key: 'publishedAt', label: 'published_at', flag: '--published-at', editable: true },
  { key: 'coverImage', label: 'cover_image', flag: '--cover-image', editable: true },
  { key: 'coverAlt', label: 'cover_alt', flag: '--cover-alt', editable: true },
  { key: 'lastReviewed', label: 'last_reviewed', flag: '--last-reviewed', editable: true },
  { key: 'technologies', label: 'technologies', editable: false, note: 'edit in Obsidian' },
  { key: 'relatedProjects', label: 'related_projects', editable: false, note: 'edit in Obsidian' },
  { key: 'relatedAssets', label: 'related_assets', editable: false, note: 'edit in Obsidian' },
];

function fieldValue(item, key) {
  if (key in item.edits) return item.edits[key];
  if (key === 'technologies' || key === 'relatedProjects' || key === 'relatedAssets') {
    return (item[key] || []).join(', ');
  }
  return item[key];
}

function diff(model) {
  const desired = model.items.slice(0, model.divider).map((i) => i.slug);
  const featuredChanged = JSON.stringify(desired) !== JSON.stringify(model.origFeatured);
  const removed = model.origFeatured.filter((s) => !desired.includes(s));
  const publishFlips = model.items.filter((i) => i.published !== model.origPublished.get(i.slug));
  const fieldEdits = model.items.filter((i) => Object.keys(i.edits).length > 0);
  return { desired, removed, featuredChanged, publishFlips, fieldEdits };
}

function hasStaged(model) {
  const d = diff(model);
  return d.featuredChanged || d.publishFlips.length > 0 || d.fieldEdits.length > 0;
}

// ---- mutations --------------------------------------------------------------

function moveCursor(model, delta) {
  // items.length is the trailing "new writeup…" row.
  model.cursor = Math.min(model.items.length, Math.max(0, model.cursor + delta));
}

function moveItem(model, delta) {
  const i = model.cursor;
  if (i >= model.items.length) return;
  if (delta < 0) {
    if (i === 0) return;
    if (i === model.divider) {
      model.divider += 1; // first unfeatured crosses the line: becomes last featured
      return;
    }
    [model.items[i - 1], model.items[i]] = [model.items[i], model.items[i - 1]];
    model.cursor = i - 1;
  } else {
    if (i === model.items.length - 1) return;
    if (i === model.divider - 1) {
      model.divider -= 1; // last featured crosses the line: becomes first unfeatured
      return;
    }
    [model.items[i + 1], model.items[i]] = [model.items[i], model.items[i + 1]];
    model.cursor = i + 1;
  }
}

function toggleFeatured(model) {
  const i = model.cursor;
  const item = model.items[i];
  if (!item) return;
  if (i < model.divider) {
    model.items.splice(i, 1);
    model.divider -= 1;
    model.items.splice(model.divider, 0, item);
    model.cursor = model.divider;
  } else {
    model.items.splice(i, 1);
    model.items.splice(model.divider, 0, item);
    model.cursor = model.divider;
    model.divider += 1;
  }
}

function togglePublished(model) {
  const item = model.items[model.cursor];
  if (item) item.published = !item.published;
}

function createWriteup(model, slug) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    model.flash = `${RED}slug must be lowercase-kebab-case: '${slug}'${RESET}`;
    return false;
  }
  if (model.items.some((i) => i.slug === slug)) {
    model.flash = `${RED}writeup already exists: ${slug}${RESET}`;
    return false;
  }
  const res = spawnSync(SITE_BIN, ['new-writeup', slug], { encoding: 'utf8' });
  if (res.status !== 0) {
    const reason = ((res.stderr || res.stdout || '').trim().split('\n').pop() || 'failed').trim();
    model.flash = `${RED}new-writeup failed: ${reason}${RESET}`;
    return false;
  }
  // Pull the scaffold's real frontmatter so the detail view edits the truth.
  const drafts = mcp(['list-writeups', '--filter', 'draft']);
  const summary = drafts.ok ? (drafts.json.writeups || []).find((w) => w.slug === slug) : null;
  const item = summary ? toItem(summary) : toItem({ slug, title: slug, published: false });
  model.items.push(item);
  model.origPublished.set(slug, item.published);
  model.created.push(slug);
  model.cursor = model.items.length - 1;
  const prep = mcp(['prepare-writeup-publish', slug]);
  const v = prep.json && prep.json.validation;
  if (v) {
    model.issues.set(slug, adjustedIssues(v, false));
    model.nits.set(slug, v.nits || []);
  }
  model.flash = `${GREEN}created 05 Writeups/${slug}/ — fill in the frontmatter${RESET}`;
  return true;
}

function openInObsidian(model) {
  const item = model.items[model.cursor];
  if (!item) return;
  const vaultPath = process.env.SVMC_VAULT_PATH || '';
  const vaultName = vaultPath.split('/').filter(Boolean).pop() || 'Severino Labs';
  const uri =
    'obsidian://open?vault=' +
    encodeURIComponent(vaultName) +
    '&file=' +
    encodeURIComponent(`05 Writeups/${item.slug}/index`);
  spawnSync('open', [uri]);
  model.flash = `${DIM}opened ${item.slug} in Obsidian${RESET}`;
}

// ---- rendering --------------------------------------------------------------

function truncate(text, width) {
  if (width <= 1) return '';
  const s = String(text);
  return s.length > width ? s.slice(0, width - 1) + '…' : s;
}

function stateIcon(model, item) {
  const flipped = item.published !== model.origPublished.get(item.slug);
  if (item.published) return flipped ? `${GREEN}▲${RESET}` : `${GREEN}●${RESET}`;
  return flipped ? `${YELLOW}▼${RESET}` : `${MAGENTA}◌${RESET}`;
}

function stateTag(model, item) {
  const flipped = item.published !== model.origPublished.get(item.slug);
  if (item.published && flipped) return { plain: '[will publish]  ', text: `${GREEN}[will publish]  ${RESET}` };
  if (!item.published && flipped) return { plain: '[will unpublish]  ', text: `${YELLOW}[will unpublish]  ${RESET}` };
  if (!item.published) return { plain: '[draft]  ', text: `${MAGENTA}[draft]  ${RESET}` };
  return { plain: '', text: '' };
}

function listFrame(model) {
  const cols = process.stdout.columns || 110;
  const slugWidth = Math.max(...model.items.map((i) => i.slug.length), 10) + 2;
  const out = [];

  out.push('');
  out.push(drawTabBar(model));
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);
  out.push(`  ${BOLD}site manage${RESET}${DIM} — ${GREEN}●${RESET}${DIM} published · ${MAGENTA}◌${RESET}${DIM} draft · ${RED}!${RESET}${DIM} gate issues · edits stay staged until you save${RESET}`);
  out.push('');
  out.push(`  ${BOLD}FEATURED${RESET}  ${DIM}home page renders this order${RESET}`);

  model.items.forEach((item, idx) => {
    if (idx === model.divider) {
      out.push(`  ${DIM}──── not featured ${'─'.repeat(Math.max(4, cols - 22))}${RESET}`);
    }
    const selected = idx === model.cursor;
    const grabbed = selected && model.mode === 'move';
    const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
    const slot = idx < model.divider ? `${CYAN}${String(idx + 1).padStart(2)}${RESET}` : `${DIM} ·${RESET}`;
    const tag = stateTag(model, item);
    const gateMark = (model.issues.get(item.slug) || []).length ? `${RED}!${RESET}` : ' ';
    const edited = Object.keys(item.edits).length ? `${YELLOW}*${RESET}` : ' ';
    let slugText = item.slug.padEnd(slugWidth);
    if (grabbed) slugText = `${INVERT}${slugText}${RESET}`;
    else if (selected) slugText = `${BOLD}${slugText}${RESET}`;
    const title = `${DIM}${truncate(item.title, cols - slugWidth - tag.plain.length - 15)}${RESET}`;
    out.push(`  ${pointer} ${slot} ${stateIcon(model, item)} ${gateMark}${edited}${slugText}${tag.text}${title}`);
  });
  if (model.divider === model.items.length) {
    out.push(`  ${DIM}──── not featured ${'─'.repeat(Math.max(4, cols - 22))}${RESET}`);
  }
  {
    const selNew = model.cursor === model.items.length;
    const pointer = selNew ? `${CYAN}▸${RESET}` : ' ';
    const label = selNew ? `${BOLD}new writeup…${RESET}` : `${DIM}new writeup…${RESET}`;
    out.push(`  ${pointer} ${DIM} +${RESET}     ${label}`);
  }

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
    out.push('');
  }

  const { featuredChanged, publishFlips, fieldEdits } = diff(model);
  const staged = [];
  if (featuredChanged) staged.push('featured order');
  if (publishFlips.length) staged.push(`${publishFlips.length} publish flip${publishFlips.length > 1 ? 's' : ''}`);
  if (fieldEdits.length) staged.push(`${fieldEdits.length} frontmatter edit${fieldEdits.length > 1 ? 's' : ''}`);
  out.push(
    staged.length
      ? `  ${YELLOW}staged: ${staged.join(' + ')} — press s to save${RESET}`
      : `  ${DIM}no staged changes${RESET}`,
  );
  out.push('');

  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  if (model.mode === 'move') {
    const slug = model.items[model.cursor]?.slug || '';
    out.push(`  ${BOLD}moving ${slug}${RESET}${DIM} — ↑/↓ move · crossing the line features/unfeatures · space or enter drops it${RESET}`);
  } else if (model.mode === 'new') {
    out.push(`  ${BOLD}new writeup slug:${RESET} ${model.input}${INVERT} ${RESET}`);
    out.push(`  ${DIM}lowercase-kebab-case → becomes jseverino.com/portfolio/<slug>/ · enter create · esc cancel${RESET}`);
  } else if (model.mode === 'confirm-quit') {
    out.push(`  ${YELLOW}unsaved changes — s save and exit · d discard and exit · esc keep working${RESET}`);
  } else if (model.mode === 'confirm-reload') {
    out.push(`  ${YELLOW}unsaved changes will be lost — press y or r to reload · esc keep working${RESET}`);
  } else if (model.cursor === model.items.length) {
    const saveHint = hasStaged(model) ? ' · s save' : '';
    out.push(`  ${DIM}↑/↓ select · enter create a new writeup · → site tab · Ctrl+R reload${saveHint} · q quit${RESET}`);
  } else {
    const saveHint = hasStaged(model) ? ' · s save' : '';
    out.push(`  ${DIM}↑/↓ select · enter open · space move · f feature/unfeature · p publish/unpublish${RESET}`);
    out.push(`  ${DIM}n new writeup · o open in Obsidian · → site tab · Ctrl+R reload${saveHint} · q quit${RESET}`);
  }
  return out.join('\n');
}

function detailFrame(model) {
  const cols = process.stdout.columns || 110;
  const item = model.items[model.cursor];
  const idx = model.cursor;
  const slot = idx < model.divider ? `featured slot ${idx + 1}` : 'not featured';
  const out = [];

  out.push('');
  out.push(drawTabBar(model));
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);
  out.push(`  ${BOLD}${item.slug}${RESET}  ${stateIcon(model, item)} ${DIM}${item.published ? 'published' : 'draft'} · ${slot}${RESET}`);
  out.push('');

  FIELDS.forEach((f, i) => {
    const selected = i === model.field && model.mode !== 'edit';
    const editing = i === model.field && model.mode === 'edit';
    const pointer = selected || editing ? `${CYAN}▸${RESET}` : ' ';
    const stagedMark = f.key in item.edits ? `${YELLOW}*${RESET}` : ' ';
    const label = (selected ? BOLD : f.editable ? '' : DIM) + f.label.padEnd(14) + RESET;
    let value;
    if (editing) {
      value = `${model.input}${INVERT} ${RESET}`;
    } else {
      const raw = fieldValue(item, f.key) || (f.editable ? `${DIM}(empty)${RESET}` : '');
      value = truncate(raw, cols - 24) + (f.note ? `  ${DIM}(${f.note})${RESET}` : '');
      if (f.key in item.edits) value = `${YELLOW}${value}${RESET}`;
    }
    out.push(`  ${pointer} ${stagedMark}${label}${value}`);
  });

  const issues = model.issues.get(item.slug) || [];
  const nits = model.nits.get(item.slug) || [];
  if (issues.length || nits.length) {
    out.push('');
    for (const issue of issues.slice(0, 6)) out.push(`    ${RED}!${RESET} ${issue}`);
    for (const nit of nits.slice(0, 4)) out.push(`    ${DIM}· ${nit}${RESET}`);
  }

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
    out.push('');
  }
  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  if (model.mode === 'edit') {
    out.push(`  ${DIM}type to edit · enter stage the change · esc cancel · Ctrl+U clear · Ctrl+W delete word${RESET}`);
  } else {
    out.push(`  ${DIM}↑/↓ field · enter edit · p publish/unpublish · t touch last_reviewed · r revert changes${RESET}`);
    out.push(`  ${DIM}o open in Obsidian · Ctrl+R reload · esc back · changes save with s on list screen${RESET}`);
  }
  return out.join('\n');
}

function siteFrame(model) {
  const cols = process.stdout.columns || 110;
  const out = [];
  if (!model.siteStatus) model.siteStatus = loadSiteStatus();
  const status = model.siteStatus;
  
  out.push('');
  out.push(drawTabBar(model));
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);
  out.push(`  ${BOLD}site manage${RESET}${DIM} — manage local servers, pre-flight checks, and publish${RESET}`);
  out.push('');

  out.push(`  ${BOLD}SYSTEM STATUS${RESET}  ${DIM}as of ${status.loadedAt}${RESET}`);
  out.push('');

  const devStatus = status.devServerOpen
    ? `${GREEN}● Running${RESET} on http://127.0.0.1:${DEV_PORT}`
    : `${DIM}◌ Offline${RESET}`;
  out.push(`    Astro Dev Server     ${devStatus}`);

  const compareStatus = status.compareOpen
    ? `${GREEN}● Running${RESET} on https://compare.homelab:${COMPARE_PORT}`
    : `${DIM}◌ Offline${RESET}`;
  out.push(`    SiteDrift Compare    ${compareStatus}`);

  out.push('');

  const gitStatusColor = status.gitChanges > 0 ? YELLOW : GREEN;
  const gitStatusText = status.gitChanges > 0
    ? `${gitStatusColor}● ${status.gitChanges} uncommitted changes${RESET}`
    : `${GREEN}● clean${RESET}`;
  out.push(`    Git Working Tree     ${gitStatusText}`);

  const gitBranchText = `${status.gitBranch} ${DIM}(${status.gitAheadBehind})${RESET}`;
  out.push(`    Git Branch           ${gitBranchText}`);

  if (status.commitHash) {
    const subject = truncate(status.commitSubject, cols - 40);
    out.push(`    Last Commit          ${CYAN}${status.commitHash}${RESET} ${subject} ${DIM}(${status.commitAge})${RESET}`);
  }

  const buildColor = status.distStatus.startsWith('Present') ? GREEN : DIM;
  out.push(`    Astro Build (dist)   ${buildColor}● ${status.distStatus}${RESET}`);

  const secColor = status.securityStatus.includes('expires') ? GREEN : RED;
  out.push(`    Security Signature   ${secColor}● ${status.securityStatus}${RESET}`);

  const liveText = !status.liveCode
    ? `${DIM}◌ unreachable${RESET}`
    : /^[23]/.test(status.liveCode)
      ? `${GREEN}● HTTP ${status.liveCode}${RESET} ${DIM}${LIVE_URL}${RESET}`
      : `${RED}● HTTP ${status.liveCode}${RESET} ${DIM}${LIVE_URL}${RESET}`;
  out.push(`    Live Site            ${liveText}`);

  out.push('');
  out.push(`  ${BOLD}CONTENT${RESET}`);
  out.push('');

  const published = model.items.filter((i) => i.published).length;
  const drafts = model.items.length - published;
  const gatedPub = model.items.filter((i) => i.published && (model.issues.get(i.slug) || []).length > 0).length;
  const gatedDraft = model.items.filter((i) => !i.published && (model.issues.get(i.slug) || []).length > 0).length;
  out.push(`    Writeups             ${published} published ${DIM}·${RESET} ${drafts} draft${drafts === 1 ? '' : 's'} ${DIM}·${RESET} ${model.divider} featured`);
  const gateParts = [];
  if (gatedPub) gateParts.push(`${RED}! ${gatedPub} published writeup${gatedPub === 1 ? '' : 's'} failing the gate${RESET}`);
  if (gatedDraft) gateParts.push(`${YELLOW}! ${gatedDraft} draft${gatedDraft === 1 ? '' : 's'} not ready to publish${RESET}`);
  out.push(`    Publish Gate         ${gateParts.length ? gateParts.join(`${DIM} · ${RESET}`) : `${GREEN}● all writeups pass${RESET}`}`);

  out.push('');
  out.push(`  ${BOLD}INTERACTIVE ACTIONS${RESET}`);
  out.push('');

  siteActions(status).forEach((a, i) => {
    const selected = i === model.actionCursor;
    const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
    const label = selected ? `${BOLD}${a.label.padEnd(20)}${RESET}` : a.label.padEnd(20);
    out.push(`  ${pointer} ${CYAN}[${a.key}]${RESET} ${label} ${DIM}${a.desc}${RESET}`);
  });

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
    out.push('');
  }

  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  out.push(`  ${DIM}↑/↓ select · enter run · ←/→ switch tabs · r reload status · q quit${RESET}`);
  
  return out.join('\n');
}

function currentFrame(model) {
  if (model.tab === 'site') return siteFrame(model);
  if (model.mode === 'detail' || model.mode === 'edit') return detailFrame(model);
  return listFrame(model);
}

function draw(model) {
  if (REPLAY) return;
  let title = 'site manage — Writeups';
  if (model.tab === 'site') title = 'site manage — Site';
  else if (model.mode === 'detail' || model.mode === 'edit') {
    title = `site manage — ${model.items[model.cursor]?.slug || 'Writeups'}`;
  }
  setTitle(title);
  process.stdout.write('\x1b[2J\x1b[H' + currentFrame(model) + '\n');
}

// ---- apply ------------------------------------------------------------------

function apply(model) {
  const { desired, removed, featuredChanged, publishFlips, fieldEdits } = diff(model);
  if (!featuredChanged && !publishFlips.length && !fieldEdits.length) {
    process.stdout.write('no changes — nothing written\n');
    return 0;
  }

  let failures = 0;
  const step = (label, res) => {
    if (res.ok) {
      process.stdout.write(`  ${GREEN}✓${RESET} ${label}\n`);
    } else {
      failures += 1;
      const reason = (res.json && res.json.error) || res.stderr || 'failed';
      process.stdout.write(`  ${RED}✗${RESET} ${label} — ${reason}\n`);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const touched = new Set([...publishFlips, ...fieldEdits].map((i) => i.slug));
  for (const slug of touched) {
    const item = model.items.find((i) => i.slug === slug);
    const args = ['update-writeup', slug];
    const what = [];
    for (const f of FIELDS) {
      if (f.flag && f.key in item.edits) {
        args.push(f.flag, item.edits[f.key]);
        what.push(f.label);
      }
    }
    if (item.published !== model.origPublished.get(slug)) {
      args.push('--published', item.published ? 'true' : 'false');
      what.push(item.published ? 'publish' : 'unpublish');
      if (item.published && !item.publishedAt && !('publishedAt' in item.edits)) {
        args.push('--published-at', today);
      }
    }
    step(`${slug}: ${what.join(', ')}`, mcp(args));
  }

  if (featuredChanged) {
    for (const slug of removed) step(`unfeature ${slug}`, mcp(['reorder-featured', slug, '0']));
    desired.forEach((slug, i) => step(`slot ${i + 1} ← ${slug}`, mcp(['reorder-featured', slug, String(i + 1)])));
  }

  const featuredDrafts = model.items.slice(0, model.divider).filter((i) => !i.published);
  for (const item of featuredDrafts) {
    process.stdout.write(`  ${YELLOW}note${RESET} ${item.slug} is featured but a draft — it holds a slot only after publishing\n`);
  }

  if (failures) {
    process.stdout.write(`${RED}${failures} change(s) failed — review above${RESET}\n`);
    return 1;
  }
  process.stdout.write(`${DIM}saved — run \`site publish\` to ship${RESET}\n`);
  return 0;
}

// ---- main -------------------------------------------------------------------

const model = load();

if (process.env.MANAGE_TUI_SMOKE) {
  // Render one static frame without a TTY — exercised by tests/site-manage.bats.
  if (process.env.MANAGE_TUI_SMOKE === 'detail') {
    model.cursor = model.items.length - 1;
    model.mode = 'detail';
    process.stdout.write(detailFrame(model) + '\n');
  } else if (process.env.MANAGE_TUI_SMOKE === 'site') {
    model.tab = 'site';
    model.siteStatus = loadSiteStatus();
    process.stdout.write(siteFrame(model) + '\n');
  } else {
    process.stdout.write(listFrame(model) + '\n');
  }
  process.exit(0);
}

if (!REPLAY && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  fail('site manage is interactive and needs a terminal. Use `site featured` for the plain list.');
}

// \x1b[22;0t / \x1b[23;0t push/pop the window title so quitting restores
// whatever the shell had set before.
const enterAlt = () => process.stdout.write('\x1b[22;0t\x1b[?1049h\x1b[?25l');
const leaveAlt = () => process.stdout.write('\x1b[?25h\x1b[?1049l\x1b[23;0t');

let lastTitle = '';
function setTitle(title) {
  if (title === lastTitle) return;
  lastTitle = title;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

let done = false;
function finish(code, message, runApply) {
  if (done) return;
  done = true;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    leaveAlt();
  }
  if (message) process.stdout.write(message + '\n');
  if (runApply) code = apply(model);
  if (!runApply && model.created.length) {
    process.stdout.write(`${DIM}note: scaffolded this session (already on disk): ${model.created.join(', ')}${RESET}\n`);
  }
  process.exit(code);
}

function lineInput(model, key) {
  if (key === '\x7f' || key === '\b') {
    model.input = model.input.slice(0, -1);
    return;
  }
  if (key === '\x15') { // Ctrl+U: clear input
    model.input = '';
    return;
  }
  if (key === '\x17') { // Ctrl+W: delete last word
    let s = model.input.trimEnd();
    const idx = s.lastIndexOf(' ');
    if (idx === -1) {
      model.input = '';
    } else {
      model.input = s.slice(0, idx + 1);
    }
    return;
  }
  const clean = key.replace(/[^\x20-\x7e]/g, '');
  if (clean) model.input += clean;
}

function handleKey(key) {
  model.flash = '';

  // Site tab key routing
  if (model.tab === 'site') {
    switch (key) {
      case '1': switchTab(model, 'writeups'); break;
      case '2': switchTab(model, 'site'); break;
      case '\t': case '\x1b[D': switchTab(model, 'writeups'); break;
      case 'r': case '\x12': { // r or Ctrl+R: regather status
        const secs = gatherSiteStatus(model);
        model.flash = `${GREEN}status refreshed${RESET}${DIM} in ${secs}s${RESET}`;
        break;
      }
      case '\x1b[A': case 'k':
        model.actionCursor = Math.max(0, model.actionCursor - 1);
        break;
      case '\x1b[B': case 'j':
        model.actionCursor = Math.min(siteActions(model.siteStatus || {}).length - 1, model.actionCursor + 1);
        break;
      case '\r':
        siteActions(model.siteStatus || {})[model.actionCursor].run(model);
        break;
      case 'd': toggleDevServer(model); break;
      case 'c': toggleCompareServer(model); break;
      case 'h': runHealthCheck(model); break;
      case 'g': runDiagnose(model); break;
      case 'b': runBuild(model); break;
      case 't': runTests(model); break;
      case 'p': runPublish(model); break;
      case 'q': case '\x1b': case '\x03':
        if (hasStaged(model)) { switchTab(model, 'writeups'); model.mode = 'confirm-quit'; break; }
        finish(0, 'exited');
        return;
      default: return;
    }
    draw(model);
    return;
  }

  switch (model.mode) {
    case 'list':
      switch (key) {
        case '\x1b[A': case 'k': moveCursor(model, -1); break;
        case '\x1b[B': case 'j': moveCursor(model, 1); break;
        case ' ': case 'm': if (model.cursor < model.items.length) model.mode = 'move'; break;
        case 'f': toggleFeatured(model); break;
        case 'p': togglePublished(model); break;
        case 'n': model.mode = 'new'; model.input = ''; break;
        case 'o': openInObsidian(model); break;
        case '1': switchTab(model, 'writeups'); break;
        case '2': switchTab(model, 'site'); break;
        case '\t': case '\x1b[C': switchTab(model, 'site'); break;
        case 'r': case '\x12': // r or Ctrl+R: reload
          if (hasStaged(model)) model.mode = 'confirm-reload';
          else reload(model);
          break;
        case '\r':
          if (model.cursor === model.items.length) { model.mode = 'new'; model.input = ''; }
          else { model.mode = 'detail'; model.field = 0; }
          break;
        case 's': finish(0, null, true); return;
        case 'q': case '\x1b': case '\x03':
          if (hasStaged(model)) model.mode = 'confirm-quit';
          else { finish(0, 'cancelled — nothing written'); return; }
          break;
        default: return;
      }
      break;

    case 'move':
      switch (key) {
        case '\x1b[A': case 'k': case '\x1b[1;2A': moveItem(model, -1); break;
        case '\x1b[B': case 'j': case '\x1b[1;2B': moveItem(model, 1); break;
        case ' ': case '\r': case '\x1b': case 'm': case 'q': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled — nothing written'); return;
        default: return;
      }
      break;

    case 'detail':
      switch (key) {
        case '\x1b[A': case 'k': model.field = Math.max(0, model.field - 1); break;
        case '\x1b[B': case 'j': model.field = Math.min(FIELDS.length - 1, model.field + 1); break;
        case 'p': togglePublished(model); break;
        case 'o': openInObsidian(model); break;
        case '\x12': // Ctrl+R: reload
          if (hasStaged(model)) model.mode = 'confirm-reload';
          else reload(model);
          break;
        case 'r': { // r: revert writeup edits
          const item = model.items[model.cursor];
          if (item) {
            item.edits = {};
            item.published = model.origPublished.get(item.slug);
            model.flash = `${YELLOW}reverted all staged changes for ${item.slug}${RESET}`;
          }
          break;
        }
        case 't': { // t: touch last_reviewed date
          const item = model.items[model.cursor];
          if (item) {
            const todayStr = new Date().toISOString().slice(0, 10);
            item.edits.lastReviewed = todayStr;
            model.flash = `${GREEN}staged last_reviewed as today (${todayStr})${RESET}`;
          }
          break;
        }
        case '\r': {
          const f = FIELDS[model.field];
          if (!f.editable) { model.flash = `${DIM}${f.label} is read-only here${f.note ? ` — ${f.note}` : ''}${RESET}`; break; }
          model.mode = 'edit';
          model.input = String(fieldValue(model.items[model.cursor], f.key) || '');
          break;
        }
        case 'q': case '\x1b': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled — nothing written'); return;
        default: return;
      }
      break;

    case 'edit':
      switch (key) {
        case '\r': {
          const f = FIELDS[model.field];
          const item = model.items[model.cursor];
          const original = f.key === 'technologies' || f.key === 'relatedProjects' || f.key === 'relatedAssets' 
            ? (item[f.key] || []).join(', ') 
            : item[f.key];
          if (model.input === String(original)) delete item.edits[f.key];
          else item.edits[f.key] = model.input;
          model.mode = 'detail';
          break;
        }
        case '\x1b': model.mode = 'detail'; break;
        case '\x03': finish(0, 'cancelled — nothing written'); return;
        default: lineInput(model, key); break;
      }
      break;

    case 'new':
      switch (key) {
        case '\r':
          if (createWriteup(model, model.input.trim())) {
            model.mode = 'detail';
            model.field = 0;
          }
          break;
        case '\x1b': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled — nothing written'); return;
        default: lineInput(model, key); break;
      }
      break;

    case 'confirm-quit':
      switch (key) {
        case 's': finish(0, null, true); return;
        case 'd': finish(0, 'discarded — nothing written'); return;
        case '\x1b': case 'q': model.mode = 'list'; break;
        case '\x03': finish(0, 'discarded — nothing written'); return;
        default: return;
      }
      break;

    case 'confirm-reload':
      switch (key) {
        case 'y': case 'r': case '\x12': reload(model); model.mode = 'list'; break;
        case 'n': case '\x1b': case 'q': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled — nothing written'); return;
        default: return;
      }
      break;
  }
  draw(model);
}

if (REPLAY) {
  // e.g. MANAGE_TUI_KEYS='down,enter' or 'p,s'. Unknown tokens are fed
  // literally, so 'n,my-slug,enter' types a slug into the line editor.
  const NAMED = {
    up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C',
    enter: '\r', esc: '\x1b', space: ' ', tab: '\t',
    'ctrl-r': '\x12', 'ctrl-c': '\x03',
  };
  for (const token of process.env.MANAGE_TUI_KEYS.split(',')) {
    const t = token.trim();
    if (t) handleKey(NAMED[t] ?? t);
  }
  process.stdout.write(currentFrame(model) + '\n');
  process.exit(0);
}

enterAlt();
draw(model);
process.stdout.on('resize', () => draw(model));
process.on('SIGINT', () => finish(0, 'cancelled — nothing written'));

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => handleKey(buf.toString('utf8')));
