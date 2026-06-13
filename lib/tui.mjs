// lib/tui.mjs — the shared visual language for the toolchain's Node TUIs.
//
// Extracted from lib/site/manage-tui.mjs so `site manage` and
// `tools describe --tui` render from one implementation, not two that drift
// (the "reuse, don't fork" rule). This module owns the look (ANSI palette,
// grapheme-aware width/clip, the scrolling line editor, the resize-fit frame
// windowing), the polish bar (alt-screen + window title), and the
// escape-sequence input pump (split arrows, bracketed paste, the esc timeout)
// — everything that is *not* specific to one tool's model. Each tool keeps its
// own model, frame renderers, key handler, and test-override env names.

// ---- palette ----------------------------------------------------------------

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const INVERT = '\x1b[7m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const CYAN = '\x1b[36m';
export const MAGENTA = '\x1b[35m';

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// ---- grapheme-aware width + clipping ----------------------------------------

export function graphemes(text) {
  return [...SEGMENTER.segment(text)].map((entry) => entry.segment);
}

export function cellWidth(grapheme) {
  if (!grapheme || /^[\p{Cc}\p{Cf}\p{Mn}\p{Me}]+$/u.test(grapheme)) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;
  const cp = grapheme.codePointAt(0);
  return (
    cp >= 0x1100 && (
      cp <= 0x115f ||
      cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    )
  ) ? 2 : 1;
}

export function displayWidth(text) {
  const plain = String(text).replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '');
  return graphemes(plain).reduce((width, grapheme) => width + cellWidth(grapheme), 0);
}

export function previousBoundary(text, index) {
  let previous = 0;
  for (const entry of SEGMENTER.segment(text)) {
    if (entry.index >= index) break;
    previous = entry.index;
  }
  return previous;
}

export function nextBoundary(text, index) {
  for (const entry of SEGMENTER.segment(text)) {
    if (entry.index > index) return entry.index;
  }
  return text.length;
}

export function suffixByWidth(text, width) {
  const parts = graphemes(text);
  const kept = [];
  let used = 0;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const cells = cellWidth(parts[i]);
    if (used + cells > width) break;
    kept.unshift(parts[i]);
    used += cells;
  }
  return kept.join('');
}

export function prefixByWidth(text, width) {
  let out = '';
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const cells = cellWidth(grapheme);
    if (used + cells > width) break;
    out += grapheme;
    used += cells;
  }
  return out;
}

export function clipAnsi(text, width) {
  if (width <= 0) return '';
  const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/y;
  let out = '';
  let visible = 0;
  let i = 0;
  let clipped = false;

  while (i < text.length) {
    ansi.lastIndex = i;
    const match = ansi.exec(text);
    if (match) {
      out += match[0];
      i += match[0].length;
      continue;
    }

    const ansiStart = i;
    let nextAnsi = text.indexOf('\x1b', i);
    if (nextAnsi === -1) nextAnsi = text.length;
    const chunk = text.slice(ansiStart, nextAnsi);
    let consumed = 0;
    for (const grapheme of graphemes(chunk)) {
      const cells = cellWidth(grapheme);
      if (visible + cells > width) {
        clipped = true;
        break;
      }
      out += grapheme;
      visible += cells;
      consumed += grapheme.length;
    }
    i += consumed;
    if (clipped) {
      clipped = true;
      break;
    }
  }

  return clipped ? out + RESET : out;
}

export function truncate(text, width) {
  const s = String(text);
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  if (width === 1) return '…';
  return clipAnsi(s, width - 1) + '…';
}

// ---- scrolling single-line editor -------------------------------------------

export function lineEditor(input, cursorIndex, width) {
  const next = nextBoundary(input, cursorIndex);
  const cursorChar = input.slice(cursorIndex, next) || ' ';
  const cursorWidth = Math.max(1, cellWidth(cursorChar));
  const available = Math.max(1, width);
  if (displayWidth(input) + (cursorIndex === input.length ? 1 : 0) <= available) {
    const before = input.slice(0, cursorIndex);
    const after = input.slice(next);
    return `${before}${INVERT}${cursorChar}${RESET}${after}`;
  }

  const rightSource = input.slice(next);
  const reserveRight = rightSource ? 1 : 0;
  const beforeBudget = Math.max(0, available - cursorWidth - reserveRight - 1);
  const before = suffixByWidth(input.slice(0, cursorIndex), beforeBudget);
  const leftHidden = before.length < cursorIndex;
  const afterBudget = Math.max(
    0,
    available - cursorWidth - displayWidth(before) - (leftHidden ? 1 : 0) - reserveRight,
  );
  const after = prefixByWidth(rightSource, afterBudget);
  const rightHidden = after.length < rightSource.length;

  return `${leftHidden ? '…' : ''}${before}${INVERT}${cursorChar}${RESET}${after}${rightHidden ? '…' : ''}`;
}

// ---- resize-fit frame windowing ---------------------------------------------
// Clip each line to the terminal width, then — if the frame is taller than the
// terminal — keep a fixed header/footer and window the body around the row
// holding the ▸ cursor, so the selection and key hints stay on screen.

export function fitFrame(frame, cols, rows) {
  const width = Math.max(1, cols - 1);
  const height = Math.max(6, rows);
  const lines = frame.split('\n').map((line) => clipAnsi(line, width));
  if (lines.length <= height) return lines.join('\n');

  const topCount = Math.min(6, Math.max(2, height - 4));
  const bottomCount = Math.min(3, Math.max(1, height - topCount - 1));
  const bodyBudget = height - topCount - bottomCount;
  const bodyStart = topCount;
  const bodyEnd = lines.length - bottomCount;
  const selected = lines.findIndex((line) => line.includes('▸'));
  const active = selected >= bodyStart && selected < bodyEnd ? selected : bodyStart;
  let start = Math.max(bodyStart, active - Math.floor(bodyBudget / 2));
  start = Math.min(start, Math.max(bodyStart, bodyEnd - bodyBudget));
  const end = Math.min(bodyEnd, start + bodyBudget);
  const body = lines.slice(start, end);
  if (start > bodyStart && body.length > 1) body[0] = `  ${DIM}↑ more${RESET}`;
  if (end < bodyEnd && body.length > 1) body[body.length - 1] = `  ${DIM}↓ more${RESET}`;
  return [...lines.slice(0, topCount), ...body, ...lines.slice(-bottomCount)].join('\n');
}

// ---- polish bar: alt screen + window title ----------------------------------
// \x1b[22;0t / \x1b[23;0t push/pop the window title so quitting restores
// whatever the shell had set before; the 1049 pair is the alt screen.

export function enterAlt() {
  process.stdout.write('\x1b[22;0t\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
}

export function leaveAlt() {
  process.stdout.write('\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l\x1b[23;0t');
}

// setTitle that only writes when the title actually changes (its own lastTitle
// diff guard), so redraws don't spam the terminal's title escape.
export function createTitleSetter() {
  let lastTitle = '';
  return function setTitle(title) {
    if (title === lastTitle) return;
    lastTitle = title;
    process.stdout.write(`\x1b]0;${title}\x07`);
  };
}

// ---- input pump -------------------------------------------------------------
// Parses a raw stdin stream into discrete keys: single bytes, CSI sequences
// (arrows / Home / End / Delete), bracketed-paste spans, and a 30 ms timeout
// that distinguishes a lone Esc from the start of an escape sequence. onKey is
// called with each key token; onPaste with the (flattened) pasted text.

// Named keys for replay harnesses: a comma-separated MANAGE_TUI_KEYS /
// DESCRIBE_TUI_KEYS script maps through this before being fed to the pump.
export const NAMED_KEYS = {
  up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C',
  'left-prefix': '\x1b[', 'left-suffix': 'D',
  enter: '\r', esc: '\x1b', space: ' ', tab: '\t', backspace: '\x7f',
  home: '\x1b[H', end: '\x1b[F', delete: '\x1b[3~', slash: '/',
  'ctrl-r': '\x12', 'ctrl-c': '\x03', 'ctrl-u': '\x15', 'ctrl-w': '\x17',
};

export function createInputPump({ onKey, onPaste }) {
  let pendingInput = '';
  let escapeTimer = null;

  function drainInput(final = false) {
    while (pendingInput) {
      if (pendingInput[0] !== '\x1b') {
        const [key] = Array.from(pendingInput);
        pendingInput = pendingInput.slice(key.length);
        onKey(key);
        continue;
      }

      if (pendingInput.length === 1) {
        if (final) {
          pendingInput = '';
          onKey('\x1b');
        }
        return;
      }

      if (pendingInput.startsWith('\x1b[')) {
        if (pendingInput.startsWith('\x1b[200~')) {
          const end = pendingInput.indexOf('\x1b[201~', 6);
          if (end === -1) {
            if (!final) return;
            pendingInput = pendingInput.slice(6);
            if (onPaste) onPaste(pendingInput);
            pendingInput = '';
            return;
          }
          const pasted = pendingInput.slice(6, end);
          pendingInput = pendingInput.slice(end + 6);
          if (onPaste) onPaste(pasted);
          continue;
        }
        const match = pendingInput.match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
        if (!match) {
          if (!final) return;
          pendingInput = pendingInput.slice(1);
          onKey('\x1b');
          continue;
        }
        pendingInput = pendingInput.slice(match[0].length);
        onKey(match[0]);
        continue;
      }

      pendingInput = pendingInput.slice(1);
      onKey('\x1b');
    }
  }

  function flushInput() {
    if (escapeTimer) {
      clearTimeout(escapeTimer);
      escapeTimer = null;
    }
    drainInput(true);
  }

  function feedInput(chunk) {
    if (escapeTimer) {
      clearTimeout(escapeTimer);
      escapeTimer = null;
    }
    pendingInput += chunk;
    drainInput();
    if (pendingInput === '\x1b' || pendingInput.startsWith('\x1b[')) {
      escapeTimer = setTimeout(flushInput, 30);
    }
  }

  return { feedInput, flushInput };
}
