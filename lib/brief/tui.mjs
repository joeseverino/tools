#!/usr/bin/env node
// brief tui — the workspace cockpit. A renderer over `brief --json --prs` (the
// aggregator, which is itself a renderer over repos/vault/writeups), NOT a fourth
// scanner. It turns the digest into ONE prioritized "what needs me now" queue —
// each row a surface, a subject, and the next-action command — and runs the loop
// verbs (ship/land/resync) on the shared runner. Vault/writeup rows are
// reminders that copy a useful string. Mirrors repos tui's SMOKE/REPLAY harness.

import { spawn, spawnSync } from 'node:child_process';
import {
  RESET, BOLD, DIM, INVERT, GREEN, YELLOW, RED, CYAN, MAGENTA,
  truncate, wrapText, fitFrame, padEndAnsi, windowLines, displayWidth,
  enterAlt, leaveAlt, createTitleSetter, createInputPump, NAMED_KEYS,
  spawnDetached, runForegroundAction,
} from '../tui.mjs';

const TOOLS_HOME = process.env.TOOLS_HOME || '';
const BRIEF_BIN = process.env.BRIEF_BIN || (TOOLS_HOME ? `${TOOLS_HOME}/bin/brief` : 'brief');
const ARGS = process.argv.slice(2);

const SMOKE = process.env.BRIEF_TUI_SMOKE;
const REPLAY = !!process.env.BRIEF_TUI_KEYS;
const TEST_COLUMNS = Number.parseInt(process.env.BRIEF_TUI_COLUMNS || '', 10);
const TEST_ROWS = Number.parseInt(process.env.BRIEF_TUI_ROWS || '', 10);

const SURFACE = {
  pr:      { label: 'PR', color: GREEN },
  repo:    { label: 'REPO', color: YELLOW },
  vault:   { label: 'VAULT', color: CYAN },
  writeup: { label: 'WRITEUP', color: MAGENTA },
};

const KEYMAP = [
  ['↑/↓ · j/k', 'move through the action queue'],
  ['Enter · c', 'copy the selected command'],
  ['x', 'run the selected action (ship / land / resync / inbox)'],
  ['o', 'open the PR on GitHub (PR rows; no shell drop)'],
  ['r', 'refresh the workspace digest'],
  ['?', 'toggle this help'],
  ['q · Esc', 'quit'],
];

function termColumns() {
  return Number.isFinite(TEST_COLUMNS) && TEST_COLUMNS > 0 ? TEST_COLUMNS : process.stdout.columns || 120;
}
function termRows() {
  return Number.isFinite(TEST_ROWS) && TEST_ROWS > 0 ? TEST_ROWS : process.stdout.rows || 34;
}
function fail(message) { process.stderr.write(message + '\n'); process.exit(1); }
function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function fetchDigestSync() {
  const res = spawnSync(BRIEF_BIN, ['--json', '--prs', ...ARGS], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout || 'null'); } catch {}
  if (res.status !== 0 || !json || json.ok === false) {
    fail('could not load `brief --json --prs`' + (res.stderr ? `: ${res.stderr.trim()}` : ''));
  }
  return json;
}

function fetchDigestAsync() {
  return new Promise((resolve, reject) => {
    const child = spawn(BRIEF_BIN, ['--json', '--prs', ...ARGS]);
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(out || 'null'); } catch {}
      if (code !== 0 || !json || json.ok === false) {
        reject(new Error('could not load `brief --json --prs`' + (err ? `: ${err.trim()}` : '')));
        return;
      }
      resolve(json);
    });
  });
}

// The whole point: collapse the digest into one severity-ranked queue of
// actionable rows. Loop verbs (ship/land/resync) and `inbox` are runnable;
// vault-review and writeup-draft rows are reminders whose action copies a useful
// string (copyOnly). Green PRs land directly; non-green PRs need --admin.
function buildItems(digest) {
  const repos = digest.repos || {};
  const vault = digest.vault || {};
  const writeups = digest.writeups || {};
  const prs = Array.isArray(digest.prs) ? digest.prs : [];
  const green = prs.filter((p) => p.ci === 'passing' || p.ci === 'none');
  const notGreen = prs.filter((p) => p.ci !== 'passing' && p.ci !== 'none');
  const items = [];

  for (const p of green) items.push({
    surface: 'pr', sev: 90, subject: `${p.repo} #${p.number} ${p.ci}`,
    why: `open PR is ${p.ci} (${p.review}) — merge it and delete the branch, then resync`,
    action: { label: 'land', cmd: `land ${shellQuote(p.repo)} --go`, effect: 'remote_write + network' },
    url: p.url,
  });
  for (const name of repos.ship || []) items.push({
    surface: 'repo', sev: 80, subject: `${name} needs ship`,
    why: 'uncommitted or unpushed work — commit, push, open/update the PR, watch CI',
    action: { label: 'ship', cmd: `ship ${shellQuote(name)} --check --watch --go`, effect: 'remote_write + network' },
  });
  for (const p of notGreen) items.push({
    surface: 'pr', sev: 70, subject: `${p.repo} #${p.number} ${p.ci}`,
    why: `open PR is ${p.ci} — landing needs --admin to bypass the failing/pending checks`,
    action: { label: 'land --admin', cmd: `land ${shellQuote(p.repo)} --go --admin`, effect: 'remote_write + network' },
    url: p.url,
  });
  for (const name of repos.resync || []) items.push({
    surface: 'repo', sev: 60, subject: `${name} needs resync`,
    why: 'merged / deleted upstream — fast-forward the default branch and prune the merged branch',
    action: { label: 'resync', cmd: `resync ${shellQuote(name)}`, effect: 'local_write + network' },
  });
  if ((vault.inbox || 0) > 0) items.push({
    surface: 'vault', sev: 40, subject: `${vault.inbox} inbox item${vault.inbox === 1 ? '' : 's'}`,
    why: 'unfiled vault inbox — triage into the vault',
    action: { label: 'inbox', cmd: 'inbox', effect: 'read' },
  });
  if ((vault.docs_to_review || 0) > 0) items.push({
    surface: 'vault', sev: 30, subject: `${vault.docs_to_review} doc${vault.docs_to_review === 1 ? '' : 's'} to review`,
    why: (vault.docs_to_review_top || []).join(', ') || 'vault docs past their review window',
    action: { label: 'copy ids', cmd: (vault.docs_to_review_top || []).join(' '), effect: 'read', copyOnly: true },
  });
  for (const slug of writeups.drafts || []) items.push({
    surface: 'writeup', sev: 20, subject: `draft: ${slug}`,
    why: 'unpublished writeup draft',
    action: { label: 'copy slug', cmd: slug, effect: 'read', copyOnly: true },
  });

  items.sort((a, b) => b.sev - a.sev);
  return items;
}

function newModel(digest = null, loading = false) {
  return { digest, items: digest ? buildItems(digest) : [], loading, error: '', cursor: 0, flash: '', running: false, help: false };
}

function load() {
  return newModel(fetchDigestSync(), false);
}

function selectedItem(model) { return model.items[model.cursor] || null; }

function clamp(model) {
  model.cursor = Math.min(Math.max(0, model.cursor), Math.max(0, model.items.length - 1));
}

function counts(items) {
  const c = { land: 0, ship: 0, resync: 0, other: 0 };
  for (const it of items) {
    if (it.action.label.startsWith('land')) c.land += 1;
    else if (it.action.label === 'ship') c.ship += 1;
    else if (it.action.label === 'resync') c.resync += 1;
    else c.other += 1;
  }
  return c;
}

function helpFrame() {
  const cols = termColumns(), rows = termRows();
  const out = ['', `  ${BOLD}brief tui${RESET}${DIM} — keys${RESET}`, `  ${'─'.repeat(Math.max(40, cols - 4))}`];
  for (const [keys, desc] of KEYMAP) out.push(`  ${CYAN}${padEndAnsi(keys, 12)}${RESET} ${DIM}${truncate(desc, Math.max(10, cols - 18))}${RESET}`);
  out.push('', `  ${DIM}Rows are ranked: ${GREEN}land${DIM} green PRs · ${YELLOW}ship${DIM} dirty · resync merged · then vault / writeups${RESET}`);
  while (out.length < rows - 1) out.push('');
  out.push(`  ${DIM}? or Esc closes${RESET}`);
  return out.join('\n');
}

function statusFrame(model) {
  const cols = termColumns(), rows = termRows();
  const out = ['', `  ${BOLD}brief tui${RESET}${DIM} — workspace cockpit${RESET}`, `  ${'─'.repeat(Math.max(40, cols - 4))}`];
  const body = Math.max(3, rows - 7);
  const msg = model.error ? `${RED}${model.error}${RESET}` : `${DIM}⋯ loading workspace digest…${RESET}`;
  for (let i = 0; i < body; i += 1) out.push(i === Math.floor(body / 2) ? `  ${msg}` : '');
  out.push('', `  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`, `  ${DIM}q quit${RESET}`);
  return out.join('\n');
}

function frame(model) {
  if (model.loading || model.error) return statusFrame(model);
  if (model.help) return helpFrame(model);
  const cols = termColumns(), rows = termRows();
  const c = counts(model.items);
  const out = [];
  out.push('');
  out.push(`  ${BOLD}brief tui${RESET}${DIM} — ${model.items.length} need you · ${c.land} land · ${c.ship} ship · ${c.resync} resync${RESET}`);
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);

  if (!model.items.length) {
    out.push('', `  ${GREEN}✓ all clear${RESET}${DIM} — nothing in the workspace needs you right now${RESET}`);
    while (out.length < rows - 3) out.push('');
    out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`, `  ${DIM}r refresh · ? help · q quit${RESET}`);
    return out.join('\n');
  }

  const cmdW = Math.max(16, Math.floor(cols * 0.42));
  const subjW = Math.max(18, cols - cmdW - 16);
  const bodyHeight = Math.max(4, rows - 11);
  const rowsOut = model.items.map((it, idx) => {
    const sel = idx === model.cursor;
    const pointer = sel ? `${CYAN}▸${RESET}` : ' ';
    const s = SURFACE[it.surface] || { label: it.surface, color: DIM };
    const chip = `${s.color}${padEndAnsi(s.label, 7)}${RESET}`;
    const subj = sel ? `${BOLD}${truncate(it.subject, subjW)}${RESET}` : truncate(it.subject, subjW);
    const cmd = `${DIM}${truncate(it.action.cmd, cmdW)}${RESET}`;
    return `${pointer} ${chip} ${padEndAnsi(subj, subjW)} ${cmd}`;
  });
  for (const line of windowLines(rowsOut, model.cursor, bodyHeight)) out.push(`  ${line}`);

  // detail for the selected row
  const sel = selectedItem(model);
  out.push('');
  if (sel) {
    for (const line of wrapText(sel.why, Math.max(20, cols - 6)).slice(0, 2)) out.push(`  ${DIM}${line}${RESET}`);
    out.push(`  ${DIM}effect ${sel.action.effect}${sel.url ? ` · ${sel.url}` : ''}${RESET}`);
  }

  out.push('');
  if (model.flash) out.push(`  ${model.flash}`);
  else out.push('');
  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  out.push(`  ${DIM}↑/↓ move · Enter copy · x run · o GitHub · r refresh · ? help · q quit${RESET}`);
  return out.join('\n');
}

const setTitle = createTitleSetter();

function draw(model) {
  if (REPLAY || SMOKE) return;
  const it = selectedItem(model);
  setTitle(it ? `brief tui — ${it.action.label}` : 'brief tui');
  process.stdout.write('\x1b[H\x1b[2J' + fitFrame(frame(model), termColumns(), termRows()));
}

function copySelected(model) {
  const it = selectedItem(model);
  if (!it || !it.action.cmd) return;
  if (!REPLAY) { try { spawnSync('pbcopy', [], { input: it.action.cmd }); } catch {} }
  model.flash = `${GREEN}copied ${it.action.label}: ${it.action.cmd}${RESET}`;
}

function refresh(model) {
  try {
    model.digest = fetchDigestSync();
    model.items = buildItems(model.digest);
    model.flash = `${GREEN}refreshed workspace digest${RESET}`;
    clamp(model);
  } catch (err) {
    model.flash = `${RED}${err.message}${RESET}`;
  }
}

async function runSelected(model) {
  const it = selectedItem(model);
  if (!it) return;
  const action = it.action;
  if (REPLAY || SMOKE) { model.flash = `${YELLOW}would run ${action.label}: ${action.cmd}${RESET}`; return; }
  if (action.copyOnly) { copySelected(model); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { model.flash = `${RED}cannot execute without a terminal${RESET}`; return; }
  model.running = true;
  const code = await runForegroundAction(action, 'brief tui');
  refresh(model);
  model.running = false;
  model.flash = code === 0
    ? `${GREEN}ran ${action.label}: ${action.cmd}${RESET}`
    : `${RED}${action.label} exited ${code}: ${action.cmd}${RESET}`;
}

function openSelected(model) {
  const it = selectedItem(model);
  if (!it || !it.url) { model.flash = `${YELLOW}no GitHub URL for this row${RESET}`; return; }
  const action = { label: 'open GitHub', cmd: `open -a Safari ${shellQuote(it.url)}` };
  if (REPLAY || SMOKE) { model.flash = `${YELLOW}would run ${action.label}: ${action.cmd}${RESET}`; return; }
  spawnDetached(action);
  model.flash = `${GREEN}opened ${it.url}${RESET}`;
}

let done = false;
function finish(code) {
  if (done) return;
  done = true;
  if (process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); leaveAlt(); }
  process.exit(code);
}

async function handleKey(model, key) {
  if (model.running) return;
  model.flash = '';
  if (model.help) {
    if (key === 'q' || key === '\x03') { finish(0); return; }
    if (key === '?' || key === '\x1b') model.help = false;
    return;
  }
  switch (key) {
    case '\x1b[A': case 'k': model.cursor -= 1; clamp(model); break;
    case '\x1b[B': case 'j': model.cursor += 1; clamp(model); break;
    case '\r': case 'c': copySelected(model); break;
    case 'x': await runSelected(model); break;
    case 'o': openSelected(model); break;
    case 'r': case '\x12': refresh(model); break;
    case '?': model.help = true; break;
    case 'q': case '\x03': case '\x1b': finish(0); return;
    default: return;
  }
}

if (SMOKE) {
  const model = load();
  process.stdout.write(frame(model) + '\n');
  process.exit(0);
}

const model = REPLAY ? load() : newModel(null, true);

const { feedInput, flushInput } = createInputPump({ onKey: (key) => { handleKey(model, key).then(() => draw(model)); }, onPaste: () => {} });

if (REPLAY) {
  for (const token of process.env.BRIEF_TUI_KEYS.split(',')) {
    const t = token.trim();
    if (t) feedInput(NAMED_KEYS[t] ?? t);
  }
  flushInput();
  process.stdout.write(fitFrame(frame(model), termColumns(), termRows()) + '\n');
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  fail('brief tui is interactive and needs a terminal. Use `brief --json` for machine-readable output.');
}

enterAlt();
draw(model);
fetchDigestAsync()
  .then((digest) => { model.digest = digest; model.items = buildItems(digest); model.loading = false; clamp(model); draw(model); })
  .catch((err) => { model.loading = false; model.error = err.message; draw(model); });
process.stdout.on('resize', () => draw(model));
process.on('SIGINT', () => finish(0));
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => feedInput(buf.toString('utf8')));
