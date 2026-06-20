#!/usr/bin/env node
// repos tui — interactive repo fleet explorer.
//
// This is a renderer over `repos --json`, not a second repo scanner. The shell
// tool owns collection; this file owns layout, filtering, copyable workflow
// commands, and the replay/smoke harness used by tests.

import { spawn, spawnSync } from 'node:child_process';
import {
  RESET, BOLD, DIM, INVERT, GREEN, YELLOW, RED, CYAN, MAGENTA,
  truncate, wrapText, lineEditor, fitFrame, padEndAnsi, windowLines, editQuery, displayWidth, prefixByWidth,
  enterAlt, leaveAlt, createTitleSetter, createInputPump, NAMED_KEYS,
} from '../tui.mjs';

const TOOLS_HOME = process.env.TOOLS_HOME || '';
const REPOS_BIN = TOOLS_HOME ? `${TOOLS_HOME}/bin/repos` : 'repos';
const ARGS = process.argv.slice(2);

const SMOKE = process.env.REPOS_TUI_SMOKE;
const REPLAY = !!process.env.REPOS_TUI_KEYS;
const TEST_COLUMNS = Number.parseInt(process.env.REPOS_TUI_COLUMNS || '', 10);
const TEST_ROWS = Number.parseInt(process.env.REPOS_TUI_ROWS || '', 10);

const VIEWS = [
  { id: 'all', label: 'All', pred: () => true },
  { id: 'dirty', label: 'Dirty', pred: (r) => dirtyCount(r) > 0 },
  { id: 'ship', label: 'Ship', pred: (r) => needsShip(r) },
  { id: 'resync', label: 'Resync', pred: (r) => needsResync(r) },
  { id: 'gone', label: 'Gone', pred: (r) => r.upstreamGone },
  { id: 'local', label: 'Local', pred: (r) => !r.hasRemote || !r.upstream },
];

function terminalColumns() {
  return Number.isFinite(TEST_COLUMNS) && TEST_COLUMNS > 0
    ? TEST_COLUMNS
    : process.stdout.columns || 120;
}

function terminalRows() {
  return Number.isFinite(TEST_ROWS) && TEST_ROWS > 0
    ? TEST_ROWS
    : process.stdout.rows || 34;
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function fetchReposSync() {
  const res = spawnSync(REPOS_BIN, ['--json', ...ARGS], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout || 'null'); } catch {}
  if (res.status !== 0 || !json || json.ok === false || !Array.isArray(json.repos)) {
    fail('could not load `repos --json` output' + (res.stderr ? `: ${res.stderr.trim()}` : ''));
  }
  return json;
}

function fetchReposAsync() {
  return new Promise((resolve, reject) => {
    const child = spawn(REPOS_BIN, ['--json', ...ARGS]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(stdout || 'null'); } catch {}
      if (code !== 0 || !json || json.ok === false || !Array.isArray(json.repos)) {
        reject(new Error('could not load `repos --json` output' + (stderr ? `: ${stderr.trim()}` : '')));
        return;
      }
      resolve(json);
    });
  });
}

function normalizeRepo(raw) {
  return {
    name: raw.name || '(unknown)',
    path: raw.path || '',
    root: raw.root || '',
    git: !!raw.git,
    branch: raw.branch || '-',
    remote: raw.remote || '',
    hasRemote: !!raw.has_remote,
    dirty: Number(raw.dirty || 0),
    untracked: Number(raw.untracked || 0),
    ahead: Number(raw.ahead || 0),
    behind: Number(raw.behind || 0),
    upstream: !!raw.upstream,
    upstreamName: raw.upstream_name || '',
    upstreamTrack: raw.upstream_track || '',
    upstreamGone: !!raw.upstream_gone,
    lastCommit: raw.last_commit || {},
    lang: raw.lang || 'other',
    pm: raw.pm || '-',
    packageManager: raw.package_manager || '-',
    nvmrc: raw.nvmrc || '-',
    nodeModules: !!raw.node_modules,
    nodeModulesSize: raw.node_modules_size || null,
    ci: Number(raw.ci || 0),
    icloudDups: Number(raw.icloud_dups || 0),
  };
}

function buildRepos(data) {
  return (data.repos || [])
    .map(normalizeRepo)
    .sort((a, b) => severity(b) - severity(a) || a.root.localeCompare(b.root) || a.name.localeCompare(b.name));
}

function dirtyCount(r) {
  return r.dirty + r.untracked;
}

function needsShip(r) {
  return dirtyCount(r) > 0 || r.ahead > 0 || !r.hasRemote || !r.upstream;
}

function needsResync(r) {
  return r.upstreamGone || r.behind > 0;
}

function severity(r) {
  let n = 0;
  if (dirtyCount(r)) n += 80;
  if (r.upstreamGone) n += 70;
  if (r.ahead) n += 45;
  if (r.behind) n += 35;
  if (!r.hasRemote || !r.upstream) n += 30;
  return n;
}

function statusBits(r) {
  const bits = [];
  if (!r.hasRemote) bits.push('local');
  if (r.hasRemote && !r.upstream) bits.push('no-upstream');
  if (r.upstreamGone) bits.push('gone');
  if (r.dirty) bits.push(`±${r.dirty}`);
  if (r.untracked) bits.push(`?${r.untracked}`);
  if (r.ahead) bits.push(`↑${r.ahead}`);
  if (r.behind) bits.push(`↓${r.behind}`);
  return bits.length ? bits : ['clean'];
}

function statusText(r) {
  return statusBits(r).join(' ');
}

function statusColor(r) {
  if (r.upstreamGone || dirtyCount(r)) return YELLOW;
  if (r.ahead || r.behind || !r.hasRemote || !r.upstream) return MAGENTA;
  return GREEN;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function repoNameArg(r) {
  return shellQuote(r.name);
}

function workflowActions(r) {
  const actions = [];
  if (needsResync(r)) {
    actions.push({
      label: 'resync preview',
      cmd: `resync --dry-run ${repoNameArg(r)}`,
      why: r.upstreamGone ? 'merged branch / deleted upstream cleanup' : 'local branch is behind upstream',
      effect: 'read + network',
    });
    actions.push({
      label: 'resync apply',
      cmd: `resync ${repoNameArg(r)}`,
      why: r.upstreamGone ? 'switch back to the default branch and prune the merged local branch when clean' : 'fetch, prune, and fast-forward the clean repo',
      effect: 'local_write + network',
    });
  }
  if (dirtyCount(r) || r.ahead) {
    actions.push({
      label: 'ship preview',
      cmd: `ship ${repoNameArg(r)} --check --watch`,
      why: dirtyCount(r) ? 'preview the commit/push/PR plan with the local gate and CI watcher selected' : 'preview pushing existing local commits through the PR loop',
      effect: 'read + network',
    });
    actions.push({
      label: 'ship apply',
      cmd: `ship ${repoNameArg(r)} --check --watch --go`,
      why: dirtyCount(r) ? 'run the local gate, commit, push, open/update the PR, and watch CI' : 'push the existing commits, open/update the PR, and watch CI',
      effect: 'remote_write + network',
    });
  } else if (!r.hasRemote || !r.upstream) {
    actions.push({
      label: 'ship preview',
      cmd: `ship ${repoNameArg(r)} --check --watch`,
      why: 'inspect how ship will handle a local or untracked branch before it writes anything',
      effect: 'read + network',
    });
  }
  actions.push({
    label: 'git status',
    cmd: `git -C ${shellQuote(r.path)} status --short --branch`,
    why: 'raw repo status without leaving the current shell',
    effect: 'read',
  });
  actions.push({
    label: 'shell here',
    cmd: `cd ${shellQuote(r.path)}`,
    why: 'jump into the working tree',
    effect: 'interactive',
    shellHere: true,
    cwd: r.path,
  });
  return actions;
}

function workflowSummary(r) {
  const notes = [];
  if (dirtyCount(r)) notes.push(`${dirtyCount(r)} uncommitted change${dirtyCount(r) === 1 ? '' : 's'} need ship`);
  if (r.ahead) notes.push(`${r.ahead} local commit${r.ahead === 1 ? '' : 's'} not pushed`);
  if (r.upstreamGone) notes.push('upstream branch is gone after merge/delete');
  if (r.behind) notes.push(`${r.behind} commit${r.behind === 1 ? '' : 's'} behind upstream`);
  if (!r.hasRemote) notes.push('no origin remote');
  else if (!r.upstream) notes.push('branch has no upstream');
  if (!notes.length) return 'clean: no ship or resync action needed';
  return notes.join(' · ');
}

function newModel(repos = [], roots = [], loading = false) {
  return {
    repos,
    roots,
    loading,
    error: '',
    view: 0,
    cursor: 0,
    actionCursor: 0,
    focus: 'repos',
    filter: '',
    query: '',
    queryCursor: 0,
    filtering: false,
    flash: '',
    running: false,
  };
}

function load() {
  const json = fetchReposSync();
  return newModel(buildRepos(json), json.roots || [], false);
}

function counts(repos) {
  return {
    total: repos.length,
    dirty: repos.filter((r) => dirtyCount(r) > 0).length,
    ship: repos.filter(needsShip).length,
    resync: repos.filter(needsResync).length,
    gone: repos.filter((r) => r.upstreamGone).length,
    local: repos.filter((r) => !r.hasRemote || !r.upstream).length,
  };
}

function matchesQuery(r, q) {
  if (!q) return true;
  const hay = [
    r.name, r.root, r.path, r.branch, r.upstreamName, r.remote,
    r.lang, r.pm, r.packageManager, r.lastCommit.subject,
  ].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

function visibleRepos(model) {
  const view = VIEWS[model.view] || VIEWS[0];
  return model.repos.filter((r) => view.pred(r) && matchesQuery(r, model.filter));
}

function selectedRepo(model) {
  return visibleRepos(model)[model.cursor] || null;
}

function selectedAction(model) {
  const repo = selectedRepo(model);
  if (!repo) return null;
  return workflowActions(repo)[model.actionCursor] || workflowActions(repo)[0] || null;
}

function truncatePlain(text, width) {
  const s = String(text || '');
  if (displayWidth(s) <= width) return s;
  if (width <= 1) return '…';
  return prefixByWidth(s, width - 1) + '…';
}

function tabBar(model) {
  const c = counts(model.repos);
  return VIEWS.map((view, i) => {
    const active = i === model.view;
    const n = c[view.id] ?? c.total;
    const label = ` ${view.label} ${n} `;
    return active ? `${BOLD}${INVERT}${label}${RESET}` : `${DIM}${label}${RESET}`;
  }).join(' ');
}

function viewKey(i) {
  return String(i + 1);
}

function leftPane(model, height, width) {
  const repos = visibleRepos(model);
  const focused = model.focus === 'repos';
  const lines = repos.map((r, idx) => {
    const selected = idx === model.cursor;
    const pointer = selected ? (focused ? `${CYAN}▸${RESET}` : `${DIM}▹${RESET}`) : ' ';
    const marker = needsResync(r) ? `${MAGENTA}R${RESET}` : needsShip(r) ? `${YELLOW}S${RESET}` : `${GREEN}✓${RESET}`;
    const name = selected ? `${BOLD}${r.name}${RESET}` : r.name;
    const status = `${statusColor(r)}${truncate(statusText(r), Math.max(8, width - 33))}${RESET}`;
    const branch = padEndAnsi(truncatePlain(r.branch, 10), 10);
    return `${pointer} ${marker} ${padEndAnsi(name, 22)} ${branch} ${status}`;
  });
  if (!lines.length) lines.push(`${DIM}  no repos match${RESET}`);
  return windowLines(lines, focused ? model.cursor : 0, height);
}

function kv(lines, label, value, width, color = DIM) {
  const labelWidth = 12;
  const wrapped = wrapText(value || '-', Math.max(10, width - labelWidth - 3));
  lines.push(`  ${DIM}${padEndAnsi(label, labelWidth)}${RESET} ${color}${wrapped[0]}${RESET}`);
  for (let i = 1; i < wrapped.length; i += 1) {
    lines.push(`${' '.repeat(labelWidth + 3)}${color}${wrapped[i]}${RESET}`);
  }
}

function actionPane(model, height, width) {
  const repo = selectedRepo(model);
  if (!repo) return windowLines([`${DIM}—${RESET}`], 0, height);
  const focused = model.focus === 'actions';
  const lines = [];
  lines.push(`${BOLD}${repo.name}${RESET} ${DIM}${repo.root}${RESET}`);
  lines.push(`${statusColor(repo)}${statusText(repo)}${RESET}`);
  for (const line of wrapText(workflowSummary(repo), width).slice(0, 3)) {
    lines.push(`${DIM}${line}${RESET}`);
  }
  lines.push('');
  kv(lines, 'path', repo.path, width, CYAN);
  kv(lines, 'branch', repo.branch, width);
  kv(lines, 'upstream', repo.upstreamName || (repo.upstream ? 'set' : 'none'), width, repo.upstreamGone ? YELLOW : DIM);
  kv(lines, 'remote', repo.remote || 'none', width);
  kv(lines, 'stack', `${repo.lang} · ${repo.pm}${repo.packageManager !== '-' ? ` · ${repo.packageManager}` : ''}${repo.ci ? ` · ${repo.ci} CI` : ''}`, width);
  kv(lines, 'commit', `${repo.lastCommit.date || '-'} ${repo.lastCommit.sha || ''} ${repo.lastCommit.subject || ''}`.trim(), width);
  lines.push('');
  lines.push(`${BOLD}WORKFLOW${RESET}`);
  const actions = workflowActions(repo);
  actions.forEach((action, idx) => {
    const selected = focused && idx === model.actionCursor;
    const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
    const label = selected ? `${BOLD}${padEndAnsi(action.label, 15)}${RESET}` : padEndAnsi(action.label, 15);
    const effect = action.effect ? `${DIM}${action.effect}${RESET}` : '';
    lines.push(`${pointer} ${label} ${CYAN}${truncate(action.cmd, Math.max(12, width - 19))}${RESET}`);
    if (selected) {
      if (effect) lines.push(`    ${effect}`);
      for (const line of wrapText(action.why, Math.max(10, width - 4)).slice(0, 2)) {
        lines.push(`    ${DIM}${line}${RESET}`);
      }
    }
  });
  return windowLines(lines, focused ? lines.findIndex((line) => line.includes('▸')) : 0, height);
}

function statusFrame(model) {
  const cols = terminalColumns();
  const rows = terminalRows();
  const out = [
    '',
    `  ${BOLD}repos tui${RESET}${DIM} — repo fleet workflow explorer${RESET}`,
    `  ${'─'.repeat(Math.max(40, cols - 4))}`,
  ];
  const body = Math.max(3, rows - 7);
  const msg = model.error ? `${RED}${model.error}${RESET}` : `${DIM}⋯ loading repo fleet…${RESET}`;
  const mid = Math.floor(body / 2);
  for (let i = 0; i < body; i += 1) out.push(i === mid ? `  ${msg}` : '');
  out.push('', `  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`, `  ${DIM}q quit${RESET}`);
  return out.join('\n');
}

function frame(model) {
  if (model.loading || model.error) return statusFrame(model);
  const cols = terminalColumns();
  const rows = terminalRows();
  const bodyHeight = Math.max(4, rows - 10);
  const leftWidth = Math.min(46, Math.max(32, Math.floor(cols * 0.42)));
  const rightWidth = Math.max(24, cols - leftWidth - 7);
  const c = counts(model.repos);
  const out = [];
  out.push('');
  out.push(`  ${BOLD}repos tui${RESET}${DIM} — ${c.total} repos · ${c.dirty} dirty · ${c.ship} ship · ${c.resync} resync · ${c.gone} gone${RESET}`);
  out.push(`  ${tabBar(model)}`);
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);
  const leftHead = model.focus === 'repos' ? `${BOLD}${INVERT} REPOS ${RESET}` : `${DIM} REPOS ${RESET}`;
  const rightHead = model.focus === 'actions' ? `${BOLD}${INVERT} DETAILS / ACTIONS ${RESET}` : `${DIM} DETAILS / ACTIONS ${RESET}`;
  out.push(`  ${padEndAnsi(leftHead, leftWidth)} ${DIM}│${RESET} ${rightHead}`);

  const left = leftPane(model, bodyHeight, leftWidth);
  const right = actionPane(model, bodyHeight, rightWidth);
  for (let i = 0; i < bodyHeight; i += 1) {
    out.push(`  ${padEndAnsi(left[i] || '', leftWidth)} ${DIM}│${RESET} ${truncate(right[i] || '', rightWidth)}`);
  }

  out.push('');
  if (model.flash) out.push(`  ${model.flash}`);
  else if (model.filter) out.push(`  ${DIM}filter:${RESET} ${YELLOW}${model.filter}${RESET}${DIM} · esc clears${RESET}`);
  else out.push('');
  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  if (model.filtering) {
    out.push(`  ${BOLD}filter:${RESET} ${lineEditor(model.query, model.queryCursor, Math.max(8, cols - 24))}`);
    out.push(`  ${DIM}type to filter name/path/branch/remote · enter apply · esc cancel${RESET}`);
  } else {
    const keys = VIEWS.map((view, i) => `${viewKey(i)} ${view.label.toLowerCase()}`).join(' · ');
    out.push(`  ${DIM}↑/↓ move · ←/→ view · ${keys} · Tab actions · / filter · enter/c copy · x run · p path · r reload · q quit${RESET}`);
  }
  return out.join('\n');
}

function draw(model) {
  if (REPLAY || SMOKE) return;
  const repo = selectedRepo(model);
  setTitle(repo ? `repos tui — ${repo.name}` : 'repos tui');
  process.stdout.write('\x1b[H\x1b[2J' + fitFrame(frame(model), terminalColumns(), terminalRows()));
}

function clamp(model) {
  const repos = visibleRepos(model);
  model.cursor = Math.min(Math.max(0, model.cursor), Math.max(0, repos.length - 1));
  const actions = selectedRepo(model) ? workflowActions(selectedRepo(model)) : [];
  model.actionCursor = Math.min(Math.max(0, model.actionCursor), Math.max(0, actions.length - 1));
  if (model.focus === 'actions' && !actions.length) model.focus = 'repos';
}

function move(model, delta) {
  if (model.focus === 'actions') model.actionCursor += delta;
  else {
    model.cursor += delta;
    model.actionCursor = 0;
  }
  clamp(model);
}

function switchView(model, delta) {
  model.view = (model.view + delta + VIEWS.length) % VIEWS.length;
  model.cursor = 0;
  model.actionCursor = 0;
  model.focus = 'repos';
  clamp(model);
}

function setView(model, index) {
  if (index < 0 || index >= VIEWS.length) return;
  model.view = index;
  model.cursor = 0;
  model.actionCursor = 0;
  model.focus = 'repos';
  clamp(model);
}

function copyText(model, text, label) {
  if (!text) return;
  if (!REPLAY) {
    try { spawnSync('pbcopy', [], { input: text }); } catch {}
  }
  model.flash = `${GREEN}copied ${label}: ${text}${RESET}`;
}

function copyAction(model) {
  const action = selectedAction(model);
  if (action) copyText(model, action.cmd, action.label);
}

function reload(model) {
  const json = fetchReposSync();
  model.repos = buildRepos(json);
  model.roots = json.roots || [];
  model.flash = `${GREEN}reloaded repo fleet${RESET}`;
  clamp(model);
}

function waitForReturn() {
  return new Promise((resolve) => {
    process.stdout.write('\n[repos tui] press return to continue...');
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

function runChild(action) {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const child = action.shellHere
      ? spawn(shell, ['-l'], { cwd: action.cwd || process.cwd(), stdio: 'inherit' })
      : spawn(shell, ['-lc', action.cmd], { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function executeAction(model) {
  const action = selectedAction(model);
  if (!action) return;
  if (REPLAY || SMOKE) {
    model.flash = `${YELLOW}would run ${action.label}: ${action.cmd}${RESET}`;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    model.flash = `${RED}cannot execute without a terminal${RESET}`;
    return;
  }

  model.running = true;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  leaveAlt();
  process.stdout.write(`\n$ ${action.cmd}\n\n`);
  const code = await runChild(action);
  await waitForReturn();
  enterAlt();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  reload(model);
  model.running = false;
  model.flash = code === 0
    ? `${GREEN}ran ${action.label}: ${action.cmd}${RESET}`
    : `${RED}${action.label} exited ${code}: ${action.cmd}${RESET}`;
}

async function handleKey(model, key) {
  if (model.running) return;
  model.flash = '';

  if (model.filtering) {
    switch (key) {
      case '\r':
        model.filter = model.query.trim();
        model.filtering = false;
        model.cursor = 0;
        model.actionCursor = 0;
        model.focus = 'repos';
        break;
      case '\x1b':
        model.filtering = false;
        model.query = model.filter;
        model.queryCursor = model.query.length;
        break;
      case '\x03': finish(0); return;
      default: editQuery(model, key); break;
    }
    clamp(model);
    return;
  }

  switch (key) {
    case '\x1b[A': case 'k': move(model, -1); break;
    case '\x1b[B': case 'j': move(model, 1); break;
    case '\x1b[D': case 'h': switchView(model, -1); break;
    case '\x1b[C': case 'l': switchView(model, 1); break;
    case '1': setView(model, 0); break;
    case '2': setView(model, 1); break;
    case '3': setView(model, 2); break;
    case '4': setView(model, 3); break;
    case '5': setView(model, 4); break;
    case '6': setView(model, 5); break;
    case '\t': model.focus = model.focus === 'repos' ? 'actions' : 'repos'; break;
    case '/': model.filtering = true; model.query = model.filter; model.queryCursor = model.query.length; break;
    case '\r':
      if (model.focus === 'repos') model.focus = 'actions';
      else copyAction(model);
      break;
    case 'c': copyAction(model); break;
    case 'x': await executeAction(model); break;
    case 'p': {
      const repo = selectedRepo(model);
      if (repo) copyText(model, repo.path, 'path');
      break;
    }
    case 'g': {
      const repo = selectedRepo(model);
      if (repo) copyText(model, `git -C ${shellQuote(repo.path)} status --short --branch`, 'git status');
      break;
    }
    case 'r': case '\x12': reload(model); break;
    case '\x1b':
      if (model.filter) {
        model.filter = '';
        model.query = '';
        model.queryCursor = 0;
        model.cursor = 0;
        clamp(model);
      } else { finish(0); return; }
      break;
    case 'q': case '\x03': finish(0); return;
    default: return;
  }
  clamp(model);
}

const setTitle = createTitleSetter();

let done = false;
function finish(code) {
  if (done) return;
  done = true;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    leaveAlt();
  }
  process.exit(code);
}

if (SMOKE) {
  const model = load();
  process.stdout.write(frame(model) + '\n');
  process.exit(0);
}

const model = REPLAY ? load() : newModel([], [], true);

const { feedInput, flushInput } = createInputPump({
  onKey: (key) => { handleKey(model, key).then(() => draw(model)); },
  onPaste: (text) => {
    if (!model.filtering) return;
    editQuery(model, text.replace(/[\r\n\t]/g, ' '));
    clamp(model);
    draw(model);
  },
});

if (REPLAY) {
  for (const token of process.env.REPOS_TUI_KEYS.split(',')) {
    const t = token.trim();
    if (t.startsWith('paste:')) feedInput(`\x1b[200~${t.slice(6)}\x1b[201~`);
    else if (t) feedInput(NAMED_KEYS[t] ?? t);
  }
  flushInput();
  process.stdout.write(fitFrame(frame(model), terminalColumns(), terminalRows()) + '\n');
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  fail('repos tui is interactive and needs a terminal. Use `repos --json` for machine-readable output.');
}

enterAlt();
draw(model);
fetchReposAsync()
  .then((data) => {
    model.repos = buildRepos(data);
    model.roots = data.roots || [];
    model.loading = false;
    clamp(model);
    draw(model);
  })
  .catch((err) => {
    model.loading = false;
    model.error = err.message;
    draw(model);
  });
process.stdout.on('resize', () => draw(model));
process.on('SIGINT', () => finish(0));

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => feedInput(buf.toString('utf8')));
