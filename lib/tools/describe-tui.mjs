#!/usr/bin/env node
// tools describe --tui — a full-screen explorer for the toolchain's command
// surface. It reads the same `tools describe` JSON the `--describe` contract
// emits (emit-once, render-many: read_doc('report-emit-once-render-many')) and
// renders it as a two-pane picker so you can find-and-use a command across 17
// tools / ~70 commands without grepping the JSON. Aggregate only: a single
// tool stays the clean `-h`; this is the third tier (`-h` · `--describe` ·
// `--tui`). Built on the shared TUI library (../tui.mjs), the same visual
// language as `site manage`.

import { spawnSync } from 'node:child_process';
import {
  RESET, BOLD, DIM, INVERT, GREEN, YELLOW, RED, CYAN, MAGENTA,
  truncate, displayWidth, lineEditor, fitFrame, previousBoundary, nextBoundary,
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

function normalize(raw, sibling) {
  return {
    name: raw.name || '(unknown)',
    description: raw.description || (raw.ok === false ? (raw.error || 'failed to describe') : ''),
    ok: raw.ok !== false,
    globalOptions: raw.global_options || [],
    positionals: raw.positionals || [],
    commands: raw.commands || [],
    sibling: !!sibling,
  };
}

function load() {
  const data = fetchDescribe();
  const tools = [
    ...data.tools.map((t) => normalize(t, false)),
    ...((data.siblings || []).map((s) => normalize(s, true))),
  ];
  return {
    tools,
    filter: '', // committed filter query
    query: '', // active line-editor buffer (filter mode)
    queryCursor: 0,
    filtering: false,
    cursor: 0, // index into the filtered tool list (left pane)
    focus: 'tools', // tools | commands
    cmdCursor: 0, // index into the selected tool's commands (right pane)
    flash: '',
  };
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

function padEndAnsi(text, width) {
  const fitted = displayWidth(text) > width ? truncate(text, width) : text;
  const pad = width - displayWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, pad));
}

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

function rightPane(model, height) {
  const tool = selectedTool(model);
  const focused = model.focus === 'commands';
  if (!tool) return windowLines([`${DIM}—${RESET}`], 0, height);
  const lines = [];
  const head = tool.sibling ? `${tool.name} ${MAGENTA}(sibling repo)${RESET}` : tool.name;
  lines.push(`${BOLD}${head}${RESET}`);
  if (tool.description) lines.push(`${DIM}${tool.description}${RESET}`);
  lines.push('');

  if (tool.globalOptions.length) {
    lines.push(`${BOLD}GLOBAL OPTIONS${RESET}`);
    for (const o of tool.globalOptions) {
      lines.push(`  ${CYAN}${padEndAnsi(argLabel(o), 22)}${RESET} ${DIM}${o.help || ''}${RESET}`);
    }
    lines.push('');
  }

  if (tool.positionals.length) {
    lines.push(`${BOLD}ARGUMENTS${RESET}`);
    for (const a of tool.positionals) {
      lines.push(`  ${padEndAnsi(argLabel(a), 22)} ${DIM}${a.help || ''}${RESET}`);
    }
    lines.push('');
  }

  let cursorLine = 0;
  if (tool.commands.length) {
    lines.push(`${BOLD}COMMANDS${RESET} ${DIM}(${tool.commands.length})${RESET}`);
    tool.commands.forEach((cmd, idx) => {
      const selected = focused && idx === model.cmdCursor;
      const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
      const hit = commandMatches(cmd, model.filter);
      let name = padEndAnsi(cmd.name, 18);
      if (selected) name = `${BOLD}${name}${RESET}`;
      else if (hit) name = `${YELLOW}${name}${RESET}`;
      if (selected) cursorLine = lines.length;
      lines.push(`${pointer} ${name} ${DIM}${cmd.summary || ''}${RESET}`);
      // Expand the focused command's own options/args — the per-command surface
      // the describe_spec now carries, made visible (not just copyable).
      if (selected && (cmd.args || []).length) {
        for (const a of cmd.args) {
          lines.push(`      ${CYAN}${padEndAnsi(argLabel(a), 20)}${RESET} ${DIM}${a.help || ''}${RESET}`);
        }
      }
    });
  } else {
    lines.push(`${DIM}no subcommands — a leaf tool${RESET}`);
    lines.push('');
    lines.push(`${DIM}Enter copies${RESET} ${CYAN}${invocation(tool, null)}${RESET}`);
  }

  return windowLines(lines, cursorLine, height);
}

// Keep `cursorLine` visible within `height` rows, with ↑/↓ more markers.
function windowLines(lines, cursorLine, height) {
  if (lines.length <= height) {
    while (lines.length < height) lines.push('');
    return lines;
  }
  let start = Math.max(0, cursorLine - Math.floor(height / 2));
  start = Math.min(start, lines.length - height);
  const slice = lines.slice(start, start + height);
  if (start > 0) slice[0] = `${DIM}  ↑ more${RESET}`;
  if (start + height < lines.length) slice[slice.length - 1] = `${DIM}  ↓ more${RESET}`;
  return slice;
}

function frame(model) {
  const cols = terminalColumns();
  const tools = visibleTools(model);
  const totalCmds = model.tools.reduce((n, t) => n + t.commands.length, 0);
  const leftWidth = Math.min(30, Math.max(20, Math.floor(cols * 0.3)));
  const rightWidth = Math.max(20, cols - leftWidth - 7);
  const out = [];

  out.push('');
  out.push(`  ${BOLD}tools describe${RESET}${DIM} — command-surface explorer · ${model.tools.length} tools · ${totalCmds} commands${RESET}`);
  out.push(`  ${'─'.repeat(Math.max(40, cols - 4))}`);

  const toolsLabel = ` TOOLS (${tools.length}) `;
  const cmdsLabel = ' DETAIL ';
  const leftHead = model.focus === 'tools' ? `${BOLD}${INVERT}${toolsLabel}${RESET}` : `${DIM}${toolsLabel}${RESET}`;
  const rightHead = model.focus === 'commands' ? `${BOLD}${INVERT}${cmdsLabel}${RESET}` : `${DIM}${cmdsLabel}${RESET}`;
  out.push(`  ${padEndAnsi(leftHead, leftWidth)} ${DIM}│${RESET} ${rightHead}`);

  // Body height: rows minus header (4) and footer (flash + divider + ≤2 hints).
  const bodyHeight = Math.max(3, terminalRows() - 9);
  const left = leftPane(model, bodyHeight);
  const right = rightPane(model, bodyHeight);
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
    out.push(`  ${DIM}↑/↓ move · Tab/←→ switch pane · / filter · enter ${model.focus === 'commands' ? 'copy command' : 'open / copy'} · q quit${RESET}`);
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

function queryInput(model, key) {
  if (key === '\x7f' || key === '\b') {
    if (model.queryCursor > 0) {
      const prev = previousBoundary(model.query, model.queryCursor);
      model.query = model.query.slice(0, prev) + model.query.slice(model.queryCursor);
      model.queryCursor = prev;
    }
    return;
  }
  if (key === '\x1b[D') { model.queryCursor = previousBoundary(model.query, model.queryCursor); return; }
  if (key === '\x1b[C') { model.queryCursor = nextBoundary(model.query, model.queryCursor); return; }
  if (key === '\x15') { model.query = ''; model.queryCursor = 0; return; } // Ctrl+U
  if (key === '\x17') { // Ctrl+W: delete last word
    const before = model.query.slice(0, model.queryCursor);
    const start = before.search(/\S+\s*$/);
    const from = start === -1 ? 0 : start;
    model.query = model.query.slice(0, from) + model.query.slice(model.queryCursor);
    model.queryCursor = from;
    return;
  }
  const clean = key.replace(/[\p{Cc}\p{Cf}]/gu, '');
  if (clean) {
    model.query = model.query.slice(0, model.queryCursor) + clean + model.query.slice(model.queryCursor);
    model.queryCursor += clean.length;
  }
}

function handleKey(model, key) {
  model.flash = '';

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
      default: queryInput(model, key); break;
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
const model = load();

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
  if (SMOKE === 'commands') focusCommands(model);
  process.stdout.write(frame(model) + '\n');
  process.exit(0);
}

const { feedInput, flushInput } = createInputPump({
  onKey: (key) => { handleKey(model, key); draw(model); },
  onPaste: (text) => {
    if (!model.filtering) return;
    queryInput(model, text.replace(/[\r\n\t]/g, ' '));
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
draw(model);
process.stdout.on('resize', () => draw(model));
process.on('SIGINT', () => finish(0));

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => feedInput(buf.toString('utf8')));
