#!/usr/bin/env node
// tools describe --tui — a full-screen explorer for the toolchain's command
// surface. It reads the same `tools describe` JSON the `--describe` contract
// emits (emit-once, render-many: read_doc('report-emit-once-render-many')) and
// renders it as a two-pane picker so you can find-and-use a command across 17
// tools / ~70 commands without grepping the JSON. Aggregate only: a single
// tool stays the clean `-h`; this is the third tier (`-h` · `--describe` ·
// `--tui`). Built on the shared TUI library (../tui.mjs), the same visual
// language as `site manage`.

import { spawn, spawnSync } from 'node:child_process';
import {
  RESET, BOLD, DIM, INVERT, GREEN, YELLOW, RED, CYAN, MAGENTA,
  truncate, displayWidth, wrapText, lineEditor, fitFrame, padEndAnsi, windowLines, editQuery,
  enterAlt, leaveAlt, createTitleSetter, createInputPump, NAMED_KEYS,
} from '../tui.mjs';

const TOOLS_HOME = process.env.TOOLS_HOME || '';
const TOOLS_BIN = TOOLS_HOME ? `${TOOLS_HOME}/bin/tools` : 'tools';
const WANT_REPOS = process.argv.slice(2).includes('--repos');

// DESCRIBE_TUI_SMOKE renders one static frame without a TTY; DESCRIBE_TUI_KEYS
// replays a comma-separated key script through the real handler and prints the
// final frame. Both mirror site manage's MANAGE_TUI_* harness (tests use them).
const SMOKE = process.env.DESCRIBE_TUI_SMOKE;
const REPLAY = !!process.env.DESCRIBE_TUI_KEYS;
const TEST_COLUMNS = Number.parseInt(process.env.DESCRIBE_TUI_COLUMNS || '', 10);
const TEST_ROWS = Number.parseInt(process.env.DESCRIBE_TUI_ROWS || '', 10);

function terminalColumns() {
  return Number.isFinite(TEST_COLUMNS) && TEST_COLUMNS > 0
    ? TEST_COLUMNS
    : process.stdout.columns || 110;
}

function terminalRows() {
  return Number.isFinite(TEST_ROWS) && TEST_ROWS > 0
    ? TEST_ROWS
    : process.stdout.rows || 30;
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

// ---- data -------------------------------------------------------------------

// Shell out to `tools describe` (mirrors how manage-tui shells out to the MCP),
// so the TUI is just another renderer of the one emit-once document.
function fetchDescribe() {
  const args = ['describe', ...(WANT_REPOS ? ['--repos'] : [])];
  const res = spawnSync(TOOLS_BIN, args, { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(res.stdout || 'null');
  } catch {
    json = null;
  }
  if (!json || json.ok === false || !Array.isArray(json.tools)) {
    fail('could not load `tools describe` output' + (res.stderr ? `: ${res.stderr.trim()}` : ''));
  }
  return json;
}

// The async twin of fetchDescribe, used by the interactive path so the federation
// (one --describe subprocess per tool) runs off the event loop instead of
// blocking the first paint. The alt-screen opens on a loading frame; this fills
// the model in when `tools describe` resolves. SMOKE/REPLAY stay on the sync
// fetchDescribe so they render one deterministic frame.
function fetchDescribeAsync() {
  return new Promise((resolve, reject) => {
    const args = ['describe', ...(WANT_REPOS ? ['--repos'] : [])];
    const child = spawn(TOOLS_BIN, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', () => {
      let json = null;
      try { json = JSON.parse(stdout || 'null'); } catch { json = null; }
      if (!json || json.ok === false || !Array.isArray(json.tools)) {
        reject(new Error('could not load `tools describe` output'
          + (stderr ? `: ${stderr.trim()}` : '')));
        return;
      }
      resolve(json);
    });
  });
}

function normalize(raw, sibling) {
  return {
    name: raw.name || '(unknown)',
    description: raw.description || (raw.ok === false ? (raw.error || 'failed to describe') : ''),
    group: raw.group || 'other',
    order: Number.isInteger(raw.order) ? raw.order : Number.MAX_SAFE_INTEGER,
    ok: raw.ok !== false,
    globalOptions: raw.global_options || [],
    positionals: raw.positionals || [],
    commands: raw.commands || [],
    paras: raw.paras || [],
    examples: raw.examples || [],
    effect: raw.effect || 'read',
    network: !!raw.network,
    interactive: !!raw.interactive,
    sibling: !!sibling,
  };
}

function buildTools(data) {
  return [
    ...data.tools.map((t) => normalize(t, false)),
    ...((data.siblings || []).map((s) => normalize(s, true))),
  ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// A fresh model. `tools` is empty until `tools describe` resolves; while empty
// the model renders a loading frame (see statusFrame) so the interactive
// alt-screen opens instantly instead of blocking on the federation.
function newModel(tools = []) {
  return {
    tools,
    loading: tools.length === 0, // showing the loading frame, no data yet
    error: '', // a fatal fetch error to render in place of the panes
    filter: '', // committed filter query
    query: '', // active line-editor buffer (filter mode)
    queryCursor: 0,
    filtering: false,
    cursor: 0, // index into the filtered tool list (left pane)
    focus: 'tools', // tools | commands
    cmdCursor: 0, // index into the selected tool's commands (right pane)
    expanded: false, // full-screen detail overlay for the selected scope
    expandScroll: 0, // scroll offset within the overlay
    flash: '',
  };
}

// Synchronous load for the SMOKE/REPLAY harnesses: one fully-populated model.
function load() {
  return newModel(buildTools(fetchDescribe()));
}

// The scope the detail views describe: the selected command when the tool has
// commands, else the leaf tool itself (rendered as a pseudo-command).
function selectedScope(model) {
  const tool = selectedTool(model);
  if (!tool) return { tool: null, cmd: null };
  const cmd = tool.commands.length ? tool.commands[model.cmdCursor] || tool.commands[0] : null;
  return { tool, cmd };
}

// ---- model helpers ----------------------------------------------------------

function matchesQuery(tool, q) {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (tool.name.toLowerCase().includes(ql)) return true;
  if (tool.description.toLowerCase().includes(ql)) return true;
  return tool.commands.some(
    (c) => c.name.toLowerCase().includes(ql) || (c.summary || '').toLowerCase().includes(ql),
  );
}

function commandMatches(cmd, q) {
  if (!q) return false;
  const ql = q.toLowerCase();
  return cmd.name.toLowerCase().includes(ql) || (cmd.summary || '').toLowerCase().includes(ql);
}

function visibleTools(model) {
  return model.tools.filter((t) => matchesQuery(t, model.filter));
}

function selectedTool(model) {
  return visibleTools(model)[model.cursor] || null;
}

function argLabel(a) {
  if (a.positional) return a.required ? `<${a.name}>` : `[${a.name}]`;
  const flag = a.flags && a.flags.length ? a.flags[a.flags.length - 1] : a.name;
  return flag + (a.takes_value ? ' <val>' : '');
}

// A risk chip from the effect triple. A plain read with no reach renders
// nothing (the quiet common case); anything that mutates, reaches off-box, or
// blocks on a TTY gets a colored line — the same signal as the focused -h
// Effect: line, colored by escalating blast radius.
function effectTag(scope) {
  const eff = scope.effect || 'read';
  const bits = [];
  if (scope.network) bits.push('network');
  if (scope.interactive) bits.push('interactive');
  if (eff === 'read' && !bits.length) return '';
  const color = eff === 'deploy' || eff === 'remote_write' ? RED
    : eff === 'vault_write' || eff === 'local_write' ? YELLOW : DIM;
  return `${DIM}effect${RESET} ${color}${[eff, ...bits].join(' · ')}${RESET}`;
}

// A ready-to-paste invocation: tool [command] then placeholders for the
// positional args and any required value-options, so it's fill-in-the-blanks.
function invocation(tool, cmd) {
  const parts = [tool.name];
  if (cmd) parts.push(cmd.name);
  const args = cmd ? (cmd.args || []) : tool.positionals;
  for (const a of args) {
    if (a.positional) parts.push(a.required ? `<${a.name}>` : `[<${a.name}>]`);
    else if (a.required && a.takes_value) {
      const flag = a.flags && a.flags.length ? a.flags[a.flags.length - 1] : a.name;
      parts.push(`${flag} <${a.name}>`);
    }
  }
  return parts.join(' ');
}

function copyInvocation(model) {
  const tool = selectedTool(model);
  if (!tool) return;
  let text;
  if (model.focus === 'commands' && tool.commands.length) {
    text = invocation(tool, tool.commands[model.cmdCursor]);
  } else {
    text = invocation(tool, null);
  }
  // pbcopy is the real side effect; skip it under replay so tests assert only
  // the flash (mirrors manage-tui gating its inline shell-outs on isTTY).
  if (!REPLAY) {
    try {
      spawnSync('pbcopy', [], { input: text });
    } catch {}
  }
  model.flash = `${GREEN}copied: ${text}${RESET}`;
}

// ---- rendering --------------------------------------------------------------

// The focused pane draws the ▸ cursor (which fitFrame windows around in short
// terminals); the unfocused pane shows its selection with a dim ▹ so there is
// exactly one ▸ in the whole frame.
function leftPane(model, height) {
  const tools = visibleTools(model);
  const focused = model.focus === 'tools';
  const lines = [];
  tools.forEach((tool, idx) => {
    const selected = idx === model.cursor;
    const pointer = selected ? (focused ? `${CYAN}▸${RESET}` : `${DIM}▹${RESET}`) : ' ';
    const badge = tool.commands.length ? `${DIM}${tool.commands.length}${RESET}` : `${DIM}·${RESET}`;
    let name = tool.name;
    if (!tool.ok) name = `${RED}${name}${RESET}`;
    else if (selected) name = `${BOLD}${name}${RESET}`;
    const tag = tool.sibling ? `${MAGENTA}◆${RESET}` : ' ';
    lines.push(`${pointer} ${tag} ${padEndAnsi(name, 18)} ${badge}`);
  });
  if (!lines.length) lines.push(`${DIM}  no tools match${RESET}`);
  return windowLines(lines, focused ? model.cursor : 0, height);
}

// Push a "label   help" row, wrapping the help under a hanging indent so long
// text flows onto continuation lines instead of getting chopped with an ellipsis.
// `labelRender` is the already-colored, already-padded label; `labelWidth` is its
// visible width so the help column (and continuation indent) line up.
function pushRow(lines, indent, labelRender, labelWidth, help, width, helpColor = DIM) {
  const helpCol = indent + labelWidth + 1;
  const wrapped = wrapText(help || '', Math.max(8, width - helpCol));
  const pad = ' '.repeat(indent);
  lines.push(`${pad}${labelRender} ${helpColor}${wrapped[0]}${RESET}`);
  for (let i = 1; i < wrapped.length; i += 1) {
    lines.push(`${' '.repeat(helpCol)}${helpColor}${wrapped[i]}${RESET}`);
  }
}

function selectedCommandDetail(tool, cmd, width) {
  const lines = [];
  const labelWidth = Math.min(18, Math.max(
    10,
    ...(cmd.args || []).map((arg) => displayWidth(argLabel(arg))),
  ));
  lines.push(`${BOLD}SELECTED${RESET}  ${CYAN}${cmd.name}${RESET}`);
  for (const line of wrapText(cmd.summary || '', width).slice(0, 2)) {
    if (line) lines.push(`${DIM}${line}${RESET}`);
  }
  const tag = effectTag(cmd);
  if (tag) lines.push(tag);
  for (const arg of cmd.args || []) {
    pushRow(
      lines,
      2,
      `${CYAN}${padEndAnsi(argLabel(arg), labelWidth)}${RESET}`,
      labelWidth,
      arg.help,
      width,
    );
  }
  lines.push(`${DIM}copy${RESET}  ${CYAN}${invocation(tool, cmd)}${RESET}`);
  return lines;
}

// Everything the contract holds for one scope, reflowed to `width` — the
// expand overlay's body. This is where the now-clean paragraph data pays off:
// `paras` are single logical strings, so wrapText reflows them to the pane
// instead of showing the hard-wrapped fragments the old data carried. cmd is
// null for a leaf tool, which renders its tool-level prose + examples.
function fullDetailLines(tool, cmd, width) {
  const scope = cmd || tool;
  const lines = [];
  const title = cmd ? `${tool.name} ${cmd.name}` : tool.name;
  lines.push(`${BOLD}${title}${RESET}`);
  const summary = cmd ? (cmd.summary || '') : (tool.description || '');
  for (const line of wrapText(summary, width)) if (line) lines.push(`${DIM}${line}${RESET}`);
  const tag = effectTag(scope);
  if (tag) { lines.push(''); lines.push(tag); }

  const args = cmd ? (cmd.args || []) : [...tool.globalOptions, ...tool.positionals];
  if (args.length) {
    const labelWidth = Math.min(24, Math.max(10, ...args.map((a) => displayWidth(argLabel(a)))));
    lines.push('', `${BOLD}ARGUMENTS & OPTIONS${RESET}`);
    for (const arg of args) {
      pushRow(lines, 2, `${CYAN}${padEndAnsi(argLabel(arg), labelWidth)}${RESET}`, labelWidth, arg.help, width);
    }
  }

  if (cmd && cmd.delegates) {
    lines.push('', `${DIM}flags owned elsewhere: ${cmd.delegates}${RESET}`);
  }

  const paras = (cmd ? cmd.paras : tool.paras) || [];
  if (paras.length) {
    lines.push('', `${BOLD}ABOUT${RESET}`);
    paras.forEach((para, idx) => {
      for (const line of wrapText(para, width)) lines.push(`${DIM}${line}${RESET}`);
      if (idx < paras.length - 1) lines.push('');
    });
  }

  const examples = (cmd ? cmd.examples : tool.examples) || [];
  if (examples.length) {
    lines.push('', `${BOLD}EXAMPLES${RESET}`);
    for (const ex of examples) {
      const comment = ex.comment ? `  ${DIM}# ${ex.comment}${RESET}` : '';
      lines.push(`  ${CYAN}${ex.command}${RESET}${comment}`);
    }
  }

  lines.push('', `${DIM}copy${RESET}  ${CYAN}${invocation(tool, cmd)}${RESET}`);
  return lines;
}

// The full-screen overlay (toggled with `e`): one scope, all of it, scrollable.
function expandedFrame(model) {
  const cols = terminalColumns();
  const rows = terminalRows();
  const width = Math.max(20, cols - 6);
  const { tool, cmd } = selectedScope(model);
  const out = [''];
  if (!tool) {
    out.push(`  ${DIM}—${RESET}`);
    return out.join('\n');
  }
  const label = cmd ? `${tool.name} ${cmd.name}` : `${tool.name} ${DIM}(leaf tool)${RESET}`;
  out.push(`  ${BOLD}${INVERT} DETAIL ${RESET} ${BOLD}${label}${RESET}`);
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);

  const body = fullDetailLines(tool, cmd, width);
  const bodyHeight = Math.max(3, rows - 7);
  const maxScroll = Math.max(0, body.length - bodyHeight);
  if (model.expandScroll > maxScroll) model.expandScroll = maxScroll;
  if (model.expandScroll < 0) model.expandScroll = 0;
  const slice = body.slice(model.expandScroll, model.expandScroll + bodyHeight);
  while (slice.length < bodyHeight) slice.push('');
  if (model.expandScroll > 0) slice[0] = `${DIM}  ↑ more${RESET}`;
  if (model.expandScroll < maxScroll) slice[slice.length - 1] = `${DIM}  ↓ more${RESET}`;
  for (const line of slice) out.push(`  ${truncate(line, width)}`);

  out.push('');
  if (model.flash) out.push(`  ${model.flash}`);
  else out.push('');
  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  out.push(`  ${DIM}↑/↓ scroll · enter/c copy · e/esc back · q quit${RESET}`);
  return out.join('\n');
}

function rightPane(model, height, width) {
  const tool = selectedTool(model);
  const focused = model.focus === 'commands';
  if (!tool) return windowLines([`${DIM}—${RESET}`], 0, height);
  const prefix = [];
  const head = tool.sibling ? `${tool.name} ${MAGENTA}(sibling repo)${RESET}` : tool.name;
  prefix.push(`${BOLD}${head}${RESET}`);
  const description = wrapText(tool.description, width).slice(0, 2);
  for (const line of description) {
    if (line) prefix.push(`${DIM}${line}${RESET}`);
  }
  while (prefix.length < 3) prefix.push('');
  prefix.push('');

  if (tool.globalOptions.length) {
    prefix.push(`${BOLD}GLOBAL OPTIONS${RESET}`);
    for (const o of tool.globalOptions) {
      pushRow(prefix, 2, `${CYAN}${padEndAnsi(argLabel(o), 22)}${RESET}`, 22, o.help, width);
    }
    prefix.push('');
  }

  if (tool.positionals.length) {
    prefix.push(`${BOLD}ARGUMENTS${RESET}`);
    for (const a of tool.positionals) {
      pushRow(prefix, 2, padEndAnsi(argLabel(a), 22), 22, a.help, width);
    }
    prefix.push('');
  }

  if (tool.commands.length) {
    prefix.push(`${BOLD}COMMANDS${RESET} ${DIM}(${tool.commands.length})${RESET}`);
    const nameWidth = Math.min(
      24,
      Math.max(14, ...tool.commands.map((cmd) => displayWidth(cmd.name))),
    );
    const commandRows = tool.commands.map((cmd, idx) => {
      const selected = focused && idx === model.cmdCursor;
      const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
      const hit = commandMatches(cmd, model.filter);
      let name = padEndAnsi(cmd.name, nameWidth);
      if (selected) name = `${BOLD}${name}${RESET}`;
      else if (hit) name = `${YELLOW}${name}${RESET}`;
      const summary = truncate(cmd.summary || '', Math.max(8, width - nameWidth - 3));
      return `${pointer} ${name} ${DIM}${summary}${RESET}`;
    });
    const selected = tool.commands[model.cmdCursor] || tool.commands[0];
    const detail = selectedCommandDetail(tool, selected, width);
    const detailHeight = Math.min(9, Math.max(5, Math.floor(height * 0.3)));
    let shownDetail;
    if (detail.length > detailHeight) {
      shownDetail = [
        ...detail.slice(0, Math.max(1, detailHeight - 2)),
        `${DIM}… press ${RESET}${CYAN}e${RESET}${DIM} to expand (full prose + examples)${RESET}`,
        detail[detail.length - 1],
      ];
    } else {
      shownDetail = [...detail];
    }
    while (shownDetail.length < detailHeight) shownDetail.push('');
    const listHeight = Math.max(3, height - prefix.length - detailHeight - 1);
    const commands = windowLines(commandRows, focused ? model.cmdCursor : 0, listHeight);
    const lines = [
      ...prefix,
      ...commands,
      `${DIM}${'─'.repeat(Math.max(8, width))}${RESET}`,
      ...shownDetail,
    ];
    return lines.slice(0, height);
  } else {
    const lines = [...prefix];
    lines.push(`${DIM}no subcommands — a leaf tool${RESET}`);
    const tag = effectTag(tool);
    if (tag) lines.push(tag);
    lines.push('');
    lines.push(`${DIM}Enter copies${RESET} ${CYAN}${invocation(tool, null)}${RESET}`);
    return windowLines(lines, 0, height);
  }
}

// Shown before the async federation resolves (or if it fails): the same chrome
// as the main frame, with a single centered line in place of the panes.
function statusFrame(model) {
  const cols = terminalColumns();
  const rows = terminalRows();
  const out = [
    '',
    `  ${BOLD}tools describe${RESET}${DIM} — command-surface explorer${RESET}`,
    `  ${'─'.repeat(Math.max(40, cols - 4))}`,
  ];
  const body = Math.max(3, rows - 7);
  const msg = model.error
    ? `${RED}${model.error}${RESET}`
    : `${DIM}⋯ loading command surface…${RESET}`;
  const mid = Math.floor(body / 2);
  for (let i = 0; i < body; i += 1) out.push(i === mid ? `  ${msg}` : '');
  out.push('', `  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`, `  ${DIM}q quit${RESET}`);
  return out.join('\n');
}

function frame(model) {
  if (model.expanded) return expandedFrame(model);
  if (model.loading || model.error) return statusFrame(model);
  const cols = terminalColumns();
  const tools = visibleTools(model);
  const totalCmds = model.tools.reduce((n, t) => n + t.commands.length, 0);
  const leftWidth = Math.min(27, Math.max(22, Math.floor(cols * 0.25)));
  const rightWidth = Math.max(20, cols - leftWidth - 7);
  const out = [];

  out.push('');
  out.push(`  ${BOLD}tools describe${RESET}${DIM} — command-surface explorer · ${model.tools.length} tools · ${totalCmds} commands${RESET}`);
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);

  const toolsLabel = ` TOOLS (${tools.length}) `;
  const cmdsLabel = ' COMMANDS ';
  const leftHead = model.focus === 'tools' ? `${BOLD}${INVERT}${toolsLabel}${RESET}` : `${DIM}${toolsLabel}${RESET}`;
  const rightHead = model.focus === 'commands' ? `${BOLD}${INVERT}${cmdsLabel}${RESET}` : `${DIM}${cmdsLabel}${RESET}`;
  out.push(`  ${padEndAnsi(leftHead, leftWidth)} ${DIM}│${RESET} ${rightHead}`);

  // Body height: rows minus header (4) and footer (flash + divider + ≤2 hints).
  const bodyHeight = Math.max(3, terminalRows() - 9);
  const left = leftPane(model, bodyHeight);
  const right = rightPane(model, bodyHeight, rightWidth);
  for (let i = 0; i < bodyHeight; i += 1) {
    const l = padEndAnsi(left[i] || '', leftWidth);
    const r = truncate(right[i] || '', rightWidth);
    out.push(`  ${l} ${DIM}│${RESET} ${r}`);
  }

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
  } else if (model.filter) {
    out.push(`  ${DIM}filter:${RESET} ${YELLOW}${model.filter}${RESET}${DIM} · esc clears${RESET}`);
  } else {
    out.push('');
  }

  out.push(`  ${DIM}${'─'.repeat(Math.max(40, cols - 4))}${RESET}`);
  if (model.filtering) {
    out.push(`  ${BOLD}filter:${RESET} ${lineEditor(model.query, model.queryCursor, Math.max(8, cols - 24))}`);
    out.push(`  ${DIM}type to filter tools + commands · enter apply · esc cancel${RESET}`);
  } else {
    out.push(`  ${DIM}↑/↓ move · Tab/←→ switch pane · / filter · e expand · enter ${model.focus === 'commands' ? 'copy command' : 'open / copy'} · q quit${RESET}`);
  }
  return out.join('\n');
}

function draw(model) {
  if (REPLAY || SMOKE) return;
  let title = 'tools describe';
  const tool = selectedTool(model);
  if (tool) title = `tools describe — ${tool.name}`;
  setTitle(title);
  process.stdout.write('\x1b[H\x1b[2J' + fitFrame(frame(model), terminalColumns(), terminalRows()));
}

// ---- input ------------------------------------------------------------------

function clampCursors(model) {
  const tools = visibleTools(model);
  if (model.cursor >= tools.length) model.cursor = Math.max(0, tools.length - 1);
  const tool = tools[model.cursor];
  const max = tool ? Math.max(0, tool.commands.length - 1) : 0;
  if (model.cmdCursor > max) model.cmdCursor = max;
  if (model.focus === 'commands' && (!tool || !tool.commands.length)) model.focus = 'tools';
}

function moveCursor(model, delta) {
  if (model.focus === 'commands') {
    const tool = selectedTool(model);
    const max = tool ? tool.commands.length - 1 : 0;
    model.cmdCursor = Math.min(max, Math.max(0, model.cmdCursor + delta));
  } else {
    const n = visibleTools(model).length;
    model.cursor = Math.min(n - 1, Math.max(0, model.cursor + delta));
    model.cmdCursor = 0;
  }
}

function focusCommands(model) {
  const tool = selectedTool(model);
  if (tool && tool.commands.length) {
    model.focus = 'commands';
    model.cmdCursor = 0;
  }
}

function handleKey(model, key) {
  model.flash = '';

  if (model.expanded) {
    switch (key) {
      case '\x1b[A': case 'k': model.expandScroll -= 1; break;
      case '\x1b[B': case 'j': model.expandScroll += 1; break;
      case '\r': case 'c': copyInvocation(model); break;
      case 'e': case '\x1b': model.expanded = false; model.expandScroll = 0; break;
      case 'q': case '\x03': finish(0); return;
      default: return;
    }
    if (model.expandScroll < 0) model.expandScroll = 0;
    return;
  }

  if (model.filtering) {
    switch (key) {
      case '\r':
        model.filter = model.query.trim();
        model.filtering = false;
        model.cursor = 0;
        model.cmdCursor = 0;
        model.focus = 'tools';
        break;
      case '\x1b': // esc: cancel the edit, keep the previously committed filter
        model.filtering = false;
        model.query = model.filter;
        model.queryCursor = model.query.length;
        break;
      case '\x03': finish(0); return;
      default: editQuery(model, key); break;
    }
    clampCursors(model);
    return;
  }

  switch (key) {
    case '\x1b[A': case 'k': moveCursor(model, -1); break;
    case '\x1b[B': case 'j': moveCursor(model, 1); break;
    case '\t': if (model.focus === 'tools') focusCommands(model); else model.focus = 'tools'; break;
    case '\x1b[C': case 'l': focusCommands(model); break;
    case '\x1b[D': case 'h': model.focus = 'tools'; break;
    case '/': model.filtering = true; model.query = model.filter; model.queryCursor = model.query.length; break;
    case 'e': if (selectedTool(model)) { model.expanded = true; model.expandScroll = 0; } break;
    case '\r': copyOrDescend(model); break;
    case '\x1b': // esc: clear an active filter, else quit
      if (model.filter) {
        model.filter = '';
        model.query = '';
        model.queryCursor = 0;
        model.cursor = 0;
        clampCursors(model);
      } else { finish(0); return; }
      break;
    case 'q': case '\x03': finish(0); return;
    default: return;
  }
  clampCursors(model);
}

function copyOrDescend(model) {
  const tool = selectedTool(model);
  if (!tool) return;
  if (model.focus === 'tools' && tool.commands.length) {
    focusCommands(model);
  } else {
    copyInvocation(model);
  }
}

// ---- main -------------------------------------------------------------------

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
  if (SMOKE === 'commands') focusCommands(model);
  if (SMOKE === 'expanded') { focusCommands(model); model.expanded = true; }
  process.stdout.write(frame(model) + '\n');
  process.exit(0);
}

// REPLAY needs a fully-populated model for one deterministic frame; the
// interactive path starts empty and hydrates from fetchDescribeAsync below.
const model = REPLAY ? load() : newModel();

const { feedInput, flushInput } = createInputPump({
  onKey: (key) => { handleKey(model, key); draw(model); },
  onPaste: (text) => {
    if (!model.filtering) return;
    editQuery(model, text.replace(/[\r\n\t]/g, ' '));
    clampCursors(model);
    draw(model);
  },
});

if (REPLAY) {
  for (const token of process.env.DESCRIBE_TUI_KEYS.split(',')) {
    const t = token.trim();
    if (t.startsWith('paste:')) feedInput(`\x1b[200~${t.slice(6)}\x1b[201~`);
    else if (t) feedInput(NAMED_KEYS[t] ?? t);
  }
  flushInput();
  process.stdout.write(fitFrame(frame(model), terminalColumns(), terminalRows()) + '\n');
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  fail('tools describe --tui is interactive and needs a terminal. Use `tools describe --pretty` for the JSON.');
}

enterAlt();
draw(model); // paints the loading frame immediately — no blocking federation
fetchDescribeAsync()
  .then((data) => {
    model.tools = buildTools(data);
    model.loading = false;
    clampCursors(model);
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
