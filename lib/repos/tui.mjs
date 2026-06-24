#!/usr/bin/env node
// repos tui — interactive repo fleet explorer.
//
// This is a renderer over `repos --json`, not a second repo scanner. The shell
// tool owns collection; this file owns layout, filtering, copyable workflow
// commands, and the replay/smoke harness used by tests.

import { spawn, spawnSync } from 'node:child_process';
import {
  RESET, BOLD, DIM, INVERT, GREEN, YELLOW, RED, CYAN, MAGENTA,
  truncate, wrapText, lineEditor, fitFrame, padEndAnsi, windowLines, editQuery, displayWidth,
  enterAlt, leaveAlt, createTitleSetter, createInputPump, NAMED_KEYS,
  spawnDetached, runForegroundAction,
} from '../tui.mjs';

const TOOLS_HOME = process.env.TOOLS_HOME || '';
const REPOS_BIN = TOOLS_HOME ? `${TOOLS_HOME}/bin/repos` : 'repos';
const ARGS = process.argv.slice(2);

const SMOKE = process.env.REPOS_TUI_SMOKE;
const REPLAY = !!process.env.REPOS_TUI_KEYS;
// Live runs hydrate PR/CI state asynchronously after the local snapshot paints.
// The static harnesses stay offline by default; a test opts into PR rendering
// (against the hermetic gh stub) with REPOS_TUI_PRS=1, which makes load() also
// fetch `repos --json --prs` synchronously so one deterministic frame shows it.
const PRS_SYNC = (!!SMOKE || REPLAY) && !!process.env.REPOS_TUI_PRS;
const TEST_COLUMNS = Number.parseInt(process.env.REPOS_TUI_COLUMNS || '', 10);
const TEST_ROWS = Number.parseInt(process.env.REPOS_TUI_ROWS || '', 10);

const VIEWS = [
  { id: 'all', label: 'All', pred: () => true },
  { id: 'dirty', label: 'Dirty', pred: (r) => dirtyCount(r) > 0 },
  { id: 'ship', label: 'Ship', pred: (r) => needsShip(r) },
  { id: 'pr', label: 'PRs', pred: (r) => r.pr.state === 'open' },
  { id: 'resync', label: 'Resync', pred: (r) => needsResync(r) },
  { id: 'gone', label: 'Gone', pred: (r) => r.upstreamGone },
  { id: 'local', label: 'Local', pred: (r) => (!r.hasRemote || !r.upstream) && !r.localOk },
];

// Keymap is the single source for BOTH the footer hint and the `?` overlay, so
// they can never drift (the house rule: interactive UIs self-document their
// keys). `foot` is the compact footer label; entries without one live only in
// the full `?` help. Keep the foot set to the workflow-critical keys.
const KEYMAP = [
  { keys: '↑/↓ · j/k', hint: 'move within the focused pane', foot: '↑/↓ move' },
  { keys: '←/→ · h/l', hint: 'switch workflow view', foot: '←/→ view' },
  { keys: 'Tab', hint: 'switch between the repo list and its actions', foot: 'Tab pane' },
  { keys: 'Enter', hint: 'focus actions, then copy the selected command', foot: 'Enter copy' },
  { keys: 'c', hint: 'copy the selected action command' },
  { keys: 'x', hint: 'run the selected action (commit/push/merge/resync)', foot: 'x run' },
  { keys: 's', hint: 'open a login shell in the selected repo' },
  { keys: 'd', hint: 'view the diff (git diff HEAD, paged)', foot: 'd diff' },
  { keys: 'm', hint: 'land — merge the open PR and delete its branch', foot: 'm land' },
  { keys: 'A', hint: 'resync the whole fleet (safe: skips dirty/diverged)', foot: 'A resync' },
  { keys: 'o', hint: 'open the repo on GitHub (no shell drop)' },
  { keys: 'p', hint: 'copy the repo path' },
  { keys: 'g', hint: 'copy a git status command for the repo' },
  { keys: '/', hint: 'filter by name/path/branch/remote/PR' },
  { keys: 'r', hint: 'reload the local snapshot' },
  { keys: 'F', hint: 'full refresh: git fetch + PR/CI state', foot: 'F refresh' },
  { keys: '?', hint: 'toggle this help', foot: '? help' },
  { keys: 'q · Esc', hint: 'quit', foot: 'q quit' },
];

// The footer hint, derived from KEYMAP's `foot` labels — the one place the footer
// keys are declared, so adding a key (with a `foot`) surfaces it automatically.
function footerHint() {
  return KEYMAP.filter((e) => e.foot).map((e) => e.foot).join(' · ');
}

function ciColor(ci) {
  return ci === 'passing' ? GREEN : ci === 'failing' ? RED : ci === 'pending' ? YELLOW : DIM;
}

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

function fetchReposSync(extra = []) {
  const res = spawnSync(REPOS_BIN, ['--json', ...extra, ...ARGS], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout || 'null'); } catch {}
  if (res.status !== 0 || !json || json.ok === false || !Array.isArray(json.repos)) {
    fail('could not load `repos --json` output' + (res.stderr ? `: ${res.stderr.trim()}` : ''));
  }
  return json;
}

function fetchReposAsync(extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(REPOS_BIN, ['--json', ...extra, ...ARGS]);
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

// Splice PR/CI state from a `repos --json --prs` snapshot into the live repo
// objects by path, so the async (or refresh) PR fetch updates state in place
// without disturbing the current selection or re-sorting the list.
function mergePrs(model, json) {
  const byPath = new Map((json.repos || []).map((raw) => [raw.path, raw.pr]));
  for (const repo of model.repos) {
    const pr = byPath.get(repo.path);
    if (!pr) continue;
    repo.pr = {
      number: Number(pr.number || 0),
      state: pr.state || 'none',
      ci: pr.ci || 'none',
      review: pr.review || 'none',
      url: pr.url || '',
    };
  }
  model.prsLoaded = true;
}

// Splice the git-derived state (the half a `git fetch` makes honest) from a fresh
// `repos --json --fetch` snapshot into the live repo objects by path. Same
// in-place discipline as mergePrs: update the volatile fields, never re-sort or
// move the selection. This is what lets behind/gone/resync self-correct a moment
// after launch instead of lying until a manual F. PR fields are left to mergePrs.
const FRESH_FIELDS = [
  'dirty', 'untracked', 'ahead', 'behind', 'upstream', 'upstreamName',
  'upstreamTrack', 'upstreamGone', 'needsShip', 'needsResync', 'needsAttention',
  'branch', 'branchState', 'stash',
];
function mergeFresh(model, json) {
  const byPath = new Map((json.repos || []).map((raw) => [raw.path, normalizeRepo(raw)]));
  for (const repo of model.repos) {
    const fresh = byPath.get(repo.path);
    if (!fresh) continue;
    for (const f of FRESH_FIELDS) repo[f] = fresh[f];
  }
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
    localOk: !!raw.local_ok,
    needsShip: !!raw.needs_ship,
    needsResync: !!raw.needs_resync,
    needsAttention: !!raw.needs_attention,
    branchState: raw.branch_state || '-',
    lastCommit: raw.last_commit || {},
    lang: raw.lang || 'other',
    pm: raw.pm || '-',
    packageManager: raw.package_manager || '-',
    nvmrc: raw.nvmrc || '-',
    nodeModules: !!raw.node_modules,
    nodeModulesSize: raw.node_modules_size || null,
    ci: Number(raw.ci || 0),
    icloudDups: Number(raw.icloud_dups || 0),
    stash: Number(raw.stash || 0),
    pr: {
      number: Number(raw.pr?.number || 0),
      state: raw.pr?.state || 'none',
      ci: raw.pr?.ci || 'none',
      review: raw.pr?.review || 'none',
      url: raw.pr?.url || '',
    },
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

// The ship / resync classification is owned by `repos --json` (emit-once); the
// TUI consumes the emitted flags and never re-derives them, so there is exactly
// one definition of "needs ship" / "needs resync" (in bin/repos), not a second
// formula here that could silently drift.
function needsShip(r) {
  return r.needsShip;
}

function needsResync(r) {
  return r.needsResync;
}

function severity(r) {
  let n = 0;
  if (dirtyCount(r)) n += 80;
  if (r.upstreamGone) n += 70;
  if (r.ahead) n += 45;
  if (r.behind) n += 35;
  if ((!r.hasRemote || !r.upstream) && !r.localOk) n += 30;
  return n;
}

function statusBits(r) {
  const bits = [];
  if (!r.hasRemote) bits.push(r.localOk ? 'local-ok' : 'local');
  if (r.hasRemote && !r.upstream) bits.push('no-upstream');
  if (r.upstreamGone) bits.push('gone');
  if (r.dirty) bits.push(`±${r.dirty}`);
  if (r.untracked) bits.push(`?${r.untracked}`);
  if (r.ahead) bits.push(`↑${r.ahead}`);
  if (r.behind) bits.push(`↓${r.behind}`);
  if (r.stash) bits.push(`⚑${r.stash}`);
  return bits.length ? bits : ['clean'];
}

function statusText(r) {
  return statusBits(r).join(' ');
}

function statusColor(r) {
  if (r.upstreamGone || dirtyCount(r)) return YELLOW;
  if (r.ahead || r.behind || ((!r.hasRemote || !r.upstream) && !r.localOk)) return MAGENTA;
  return GREEN;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function repoNameArg(r) {
  return shellQuote(r.name);
}

function githubUrl(r) {
  const remote = r.remote || '';
  let match = remote.match(/^git@github\.com:([^/]+\/[^.]+)(?:\.git)?$/);
  if (!match) match = remote.match(/^https:\/\/github\.com\/([^/]+\/[^.]+)(?:\.git)?$/);
  return match ? `https://github.com/${match[1]}` : '';
}

// Actions are ordered to read as the workflow loop top-to-bottom: ship (commit /
// push / PR) → land (merge) → resync (cleanup), then inspection/navigation. Each
// applicable beat is included; the rest are always-available utilities. Actions
// tagged `background:true` (open URL) run without tearing down the alt-screen.
function workflowActions(r) {
  const actions = [];
  // A stale branch (committed work behind main, no PR — repos' owned verdict)
  // is the first thing to fix: shipping onto it re-inherits already-merged work.
  if (r.branchState === 'stale') {
    actions.push({
      label: 'rebranch',
      cmd: `ship ${repoNameArg(r)} --rebranch --check --go`,
      why: 'stale branch off old main; replay its commits onto a fresh branch off origin/main, dropping any already merged',
      effect: 'remote_write + network',
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
  } else if ((!r.hasRemote || !r.upstream) && !r.localOk) {
    actions.push({
      label: 'ship preview',
      cmd: `ship ${repoNameArg(r)} --check --watch`,
      why: 'inspect how ship will handle a local or untracked branch before it writes anything',
      effect: 'read + network',
    });
  }
  if (r.pr.state === 'open') {
    const green = r.pr.ci === 'passing' || r.pr.ci === 'none';
    actions.push({
      label: 'land',
      cmd: green ? `land ${repoNameArg(r)} --go` : `land ${repoNameArg(r)} --go --admin`,
      why: green
        ? `merge PR #${r.pr.number} (${r.pr.ci}) and delete its branch — then resync`
        : `PR #${r.pr.number} is ${r.pr.ci}; --admin bypasses the failing/pending checks`,
      effect: 'remote_write + network',
    });
  }
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
  actions.push({
    label: 'diff',
    cmd: `git -C ${shellQuote(r.path)} diff HEAD`,
    why: 'page the working-tree diff against HEAD without leaving the dashboard',
    effect: 'read',
    diff: true,
  });
  actions.push({
    label: 'git status',
    cmd: `git -C ${shellQuote(r.path)} status --short --branch`,
    why: 'raw repo status without leaving the current shell',
    effect: 'read',
  });
  const url = githubUrl(r);
  if (url) {
    actions.push({
      label: 'open GitHub',
      cmd: `open -a Safari ${shellQuote(url)}`,
      why: 'open the repository on GitHub in Safari (stays in the dashboard — no shell drop)',
      effect: 'interactive + network',
      background: true,
      url,
    });
  }
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
  if (!r.hasRemote && r.localOk) notes.push('intentionally local-only');
  else if (!r.hasRemote) notes.push('no origin remote');
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
    help: false,
    prsLoaded: false,
    prsLoading: false,
    fetching: false,
  };
}

function load() {
  const json = fetchReposSync();
  const model = newModel(buildRepos(json), json.roots || [], false);
  if (PRS_SYNC) mergePrs(model, fetchReposSync(['--prs']));
  selectCurrentWorkingRepo(model);
  return model;
}

function counts(repos) {
  return {
    total: repos.length,
    dirty: repos.filter((r) => dirtyCount(r) > 0).length,
    ship: repos.filter(needsShip).length,
    pr: repos.filter((r) => r.pr.state === 'open').length,
    resync: repos.filter(needsResync).length,
    gone: repos.filter((r) => r.upstreamGone).length,
    local: repos.filter((r) => (!r.hasRemote || !r.upstream) && !r.localOk).length,
  };
}

function matchesQuery(r, q) {
  if (!q) return true;
  const hay = [
    r.name, r.root, r.path, r.branch, r.upstreamName, r.remote,
    r.lang, r.pm, r.packageManager, r.lastCommit.subject,
    r.pr.state === 'open' ? `pr #${r.pr.number} ${r.pr.ci} ${r.pr.review}` : '',
  ].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

// A right-aligned PR badge for the repo list: "#12" tinted by CI state, or empty
// until PR state has hydrated / when there is no open PR.
function prBadge(r) {
  if (r.pr.state !== 'open') return '';
  const glyph = r.pr.ci === 'passing' ? '✓' : r.pr.ci === 'failing' ? '✗' : r.pr.ci === 'pending' ? '•' : ' ';
  return `${ciColor(r.pr.ci)}#${r.pr.number}${glyph}${RESET}`;
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

function selectCurrentWorkingRepo(model) {
  const cwd = process.cwd();
  const repos = visibleRepos(model);
  const idx = repos.findIndex((repo) => cwd === repo.path || cwd.startsWith(`${repo.path}/`));
  if (idx >= 0) {
    model.cursor = idx;
    model.actionCursor = 0;
  }
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

function leftPane(model, height, width) {
  const repos = visibleRepos(model);
  const focused = model.focus === 'repos';
  const lines = repos.map((r, idx) => {
    const selected = idx === model.cursor;
    const pointer = selected ? (focused ? `${CYAN}▸${RESET}` : `${DIM}▹${RESET}`) : ' ';
    const marker = needsResync(r) ? `${MAGENTA}R${RESET}` : needsShip(r) ? `${YELLOW}S${RESET}` : `${GREEN}✓${RESET}`;
    const name = selected ? `${BOLD}${r.name}${RESET}` : r.name;
    const badge = prBadge(r);
    const badgeW = displayWidth(badge);
    // name + status fill the row; the PR badge is pinned to the right edge.
    const statusW = Math.max(6, width - 6 - 18 - (badgeW ? badgeW + 1 : 0));
    const status = padEndAnsi(`${statusColor(r)}${truncate(statusText(r), statusW)}${RESET}`, statusW);
    const left = `${pointer} ${marker} ${padEndAnsi(name, 18)} ${status}`;
    return badgeW ? `${padEndAnsi(left, width - badgeW)}${badge}` : left;
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
  if (repo.pr.state === 'open') {
    kv(lines, 'pr', `#${repo.pr.number} · ${repo.pr.ci} · ${repo.pr.review} · ${repo.pr.url}`, width, ciColor(repo.pr.ci));
  } else if (!model.prsLoaded && repo.hasRemote) {
    kv(lines, 'pr', model.prsLoading ? 'loading…' : '—', width);
  }
  if (repo.stash) kv(lines, 'stash', `${repo.stash} stash${repo.stash === 1 ? '' : 'es'} (git stash list)`, width, YELLOW);
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
  if (model.help) return helpFrame(model);
  const cols = terminalColumns();
  const rows = terminalRows();
  const bodyHeight = Math.max(4, rows - 10);
  const leftWidth = Math.min(46, Math.max(32, Math.floor(cols * 0.42)));
  const rightWidth = Math.max(24, cols - leftWidth - 7);
  const c = counts(model.repos);
  const out = [];
  out.push('');
  const prNote = (model.prsLoading || model.fetching)
    ? ` · ${DIM}syncing…${RESET}${DIM}`
    : c.pr ? ` · ${c.pr} PR` : '';
  out.push(`  ${BOLD}repos tui${RESET}${DIM} — ${c.total} repos · ${c.dirty} dirty · ${c.ship} ship${prNote} · ${c.resync} resync · ${c.gone} gone${RESET}`);
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
    out.push(`  ${DIM}type to filter name/path/branch/remote/PR · enter apply · esc cancel${RESET}`);
  } else {
    out.push(`  ${DIM}${footerHint()}${RESET}`);
  }
  return out.join('\n');
}

// Full-screen help overlay. The keymap is rendered from the one KEYMAP table that
// also feeds nothing else hand-written, so the help can't drift from the handler.
function helpFrame(model) {
  const cols = terminalColumns();
  const rows = terminalRows();
  const out = ['', `  ${BOLD}repos tui${RESET}${DIM} — keys${RESET}`, `  ${'─'.repeat(Math.max(40, cols - 4))}`];
  for (const { keys, hint } of KEYMAP) {
    out.push(`  ${CYAN}${padEndAnsi(keys, 12)}${RESET} ${DIM}${truncate(hint, Math.max(10, cols - 18))}${RESET}`);
  }
  out.push('');
  out.push(`  ${DIM}Views (←/→): ${VIEWS.map((v) => v.label).join(' · ')}${RESET}`);
  out.push(`  ${DIM}Markers: ${GREEN}✓${DIM} clean · ${YELLOW}S${DIM} needs ship · ${MAGENTA}R${DIM} needs resync · ${GREEN}#12✓${DIM}/${RED}#13✗${DIM}/${YELLOW}#14•${DIM} PR + CI${RESET}`);
  while (out.length < rows - 1) out.push('');
  out.push(`  ${DIM}? or Esc closes${RESET}`);
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

async function shellSelectedRepo(model) {
  const repo = selectedRepo(model);
  if (!repo) return;
  await executeAction(model, {
    label: 'shell',
    cmd: `cd ${shellQuote(repo.path)}`,
    why: 'open an interactive shell in the selected repo',
    effect: 'interactive',
    shellHere: true,
    cwd: repo.path,
  });
}

async function openSelectedGithub(model) {
  const repo = selectedRepo(model);
  if (!repo) return;
  const url = githubUrl(repo);
  if (!url) {
    model.flash = `${YELLOW}${repo.name} has no GitHub remote${RESET}`;
    return;
  }
  await executeAction(model, {
    label: 'open GitHub',
    cmd: `open -a Safari ${shellQuote(url)}`,
    why: 'open the selected repo on GitHub in Safari',
    effect: 'interactive + network',
    background: true,
    url,
  });
}

// Run a workflow action by label (the one the cursor need not be on): used by the
// direct keys (d diff, m land) so they act on the selected repo regardless of
// which action row is highlighted.
async function runNamedAction(model, label, missing) {
  const repo = selectedRepo(model);
  if (!repo) return;
  const action = workflowActions(repo).find((a) => a.label === label);
  if (!action) {
    model.flash = `${YELLOW}${repo.name}: ${missing}${RESET}`;
    return;
  }
  await executeAction(model, action);
}

// `d` — page the diff, but only when there is one. `git diff HEAD` is the working
// tree vs the last commit, so it is empty on a clean repo; dropping to an empty
// pager just to read "press return" is the "weird view". Say it in place instead.
async function diffSelected(model) {
  const repo = selectedRepo(model);
  if (!repo) return;
  if (repo.dirty === 0) {
    const notes = [];
    if (repo.untracked) notes.push(`${repo.untracked} untracked (not in git diff)`);
    if (repo.ahead) notes.push(`↑${repo.ahead} unpushed`);
    const tail = notes.length ? ` — ${notes.join(' · ')}` : '';
    model.flash = `${DIM}${repo.name}: no tracked changes to diff${tail}${RESET}`;
    return;
  }
  await runNamedAction(model, 'diff', 'nothing to diff');
}

async function resyncFleet(model) {
  await executeAction(model, {
    label: 'resync fleet',
    cmd: 'resync',
    why: 'reconcile every clean repo with its remote (safe: skips dirty / diverged)',
    effect: 'local_write + network',
  });
}

function reload(model) {
  const json = fetchReposSync();
  model.repos = buildRepos(json);
  model.roots = json.roots || [];
  model.prsLoaded = false;
  if (PRS_SYNC) mergePrs(model, fetchReposSync(['--prs']));
  else { hydratePrs(model); hydrateFetch(model); }
  model.flash = `${GREEN}reloaded repo fleet${RESET}`;
  clamp(model);
}

// Explicit full refresh (F): also git fetch each repo so behind/gone is honest,
// plus PR/CI state. Synchronous — it is a deliberate, user-initiated wait.
function refreshFull(model) {
  if (REPLAY || SMOKE) { reload(model); return; }
  const json = fetchReposSync(['--fetch', '--prs']);
  model.repos = buildRepos(json);
  model.roots = json.roots || [];
  model.prsLoaded = true;
  model.prsLoading = false;
  model.flash = `${GREEN}refreshed — fetched + PR/CI state${RESET}`;
  clamp(model);
}

// Pull open-PR/CI state in the background and splice it in when it lands, so the
// dashboard is usable immediately and PR columns fill a moment later. No-op in
// the static test harnesses (they stay offline unless REPOS_TUI_PRS is set, which
// routes through the synchronous merge in load/reload instead).
function hydratePrs(model) {
  if (REPLAY || SMOKE) return;
  model.prsLoading = true;
  draw(model);
  fetchReposAsync(['--prs'])
    .then((json) => { mergePrs(model, json); model.prsLoading = false; draw(model); })
    .catch(() => { model.prsLoading = false; model.flash = `${DIM}PR state unavailable (gh auth?)${RESET}`; draw(model); });
}

// The git half of self-healing state: after the instant local paint, fetch every
// repo in the background and splice fresh behind/gone/resync in place. Runs in
// parallel with hydratePrs (git vs gh — independent), so a merge you did on
// GitHub a moment ago shows up here without pressing F. Slower than the PR pass
// (git fetch is per-repo), hence its own indicator; never blocks input.
function hydrateFetch(model) {
  if (REPLAY || SMOKE) return;
  model.fetching = true;
  draw(model);
  fetchReposAsync(['--fetch'])
    .then((json) => { mergeFresh(model, json); model.fetching = false; clamp(model); draw(model); })
    .catch(() => { model.fetching = false; draw(model); });
}

async function executeAction(model, givenAction = null) {
  const action = givenAction || selectedAction(model);
  if (!action) return;
  if (REPLAY || SMOKE) {
    model.flash = `${YELLOW}would run ${action.label}: ${action.cmd}${RESET}`;
    return;
  }
  // Background actions (open a URL) never leave the alt-screen: spawn detached,
  // flash, stay put.
  if (action.background) {
    spawnDetached(action);
    model.flash = `${GREEN}opened ${action.label}${RESET}`;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    model.flash = `${RED}cannot execute without a terminal${RESET}`;
    return;
  }

  model.running = true;
  const code = await runForegroundAction(action, 'repos tui');
  // Read-only actions (diff, git status, ship/resync previews) can't change repo
  // state, so skip the full synchronous fleet rescan — that reload was the lag
  // after returning from a diff. Mutating actions (ship/land/resync apply) and a
  // shell drop (you may have committed) still reload.
  if (!/^read/.test(action.effect || '')) reload(model);
  model.running = false;
  model.flash = code === 0
    ? `${GREEN}ran ${action.label}: ${action.cmd}${RESET}`
    : `${RED}${action.label} exited ${code}: ${action.cmd}${RESET}`;
}

async function handleKey(model, key) {
  if (model.running) return;
  model.flash = '';

  if (model.help) {
    if (key === 'q' || key === '\x03') { finish(0); return; }
    if (key === '?' || key === '\x1b') model.help = false;
    return;
  }

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
    case '\t': model.focus = model.focus === 'repos' ? 'actions' : 'repos'; break;
    case '/': model.filtering = true; model.query = model.filter; model.queryCursor = model.query.length; break;
    case '\r':
      if (model.focus === 'repos') model.focus = 'actions';
      else copyAction(model);
      break;
    case 'c': copyAction(model); break;
    case 'x': await executeAction(model); break;
    case 's': await shellSelectedRepo(model); break;
    case 'd': await diffSelected(model); break;
    case 'm': await runNamedAction(model, 'land', 'no open PR to land'); break;
    case 'o': await openSelectedGithub(model); break;
    case 'A': await resyncFleet(model); break;
    case 'F': refreshFull(model); break;
    case '?': model.help = true; break;
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
    selectCurrentWorkingRepo(model);
    clamp(model);
    draw(model);
    hydratePrs(model);
    hydrateFetch(model);
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
