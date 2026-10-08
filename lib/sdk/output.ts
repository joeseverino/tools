// Status-line output shared by every tool: a bold label in a fixed column, then
// the body. Colour follows lib/sdk/color.ts (off for non-TTY and NO_COLOR).
import { open } from './color.ts';

export type Tone = 'green' | 'red' | 'yellow' | 'dim' | 'reset' | 'bold' | 'plain';

export interface Palette {
  BOLD: string;
  DIM: string;
  RESET: string;
  GREEN: string;
  RED: string;
  YELLOW: string;
}

export function palette(): Palette {
  if (open('bold') === '') return { BOLD: '', DIM: '', RESET: '', GREEN: '', RED: '', YELLOW: '' };
  return { BOLD: '\u001b[1m', DIM: '\u001b[2m', RESET: '\u001b[0m', GREEN: '\u001b[32m', RED: '\u001b[31m', YELLOW: '\u001b[33m' };
}

function toneCode(tone: Tone, p: Palette): string {
  switch (tone) {
    case 'green': return p.GREEN;
    case 'red': return p.RED;
    case 'yellow': return p.YELLOW;
    case 'dim': return p.DIM;
    case 'reset': return p.RESET;
    case 'bold':
    case 'plain': return '';
  }
}

/** Pads to a byte width, as printf does, so multibyte labels keep the columns the shell tools had. */
export function padBytes(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - Buffer.byteLength(text)));
}

/** One status line without the trailing newline. */
export function msgLine(tone: Tone, label: string, body: string, labelWidth = 10): string {
  const p = palette();
  return `  ${toneCode(tone, p)}${p.BOLD}${padBytes(label, labelWidth)}${p.RESET} ${body}`;
}

export function msg(tone: Tone, label: string, body: string, labelWidth = 10): void {
  process.stdout.write(`${msgLine(tone, label, body, labelWidth)}\n`);
}

export function msgErr(tone: Tone, label: string, body: string, labelWidth = 10): void {
  process.stderr.write(`${msgLine(tone, label, body, labelWidth)}\n`);
}

export function blank(): void {
  process.stdout.write('\n');
}

/** "\n  <verb> N <noun>s\n\n"; noun defaults to "file". */
export function header(verb: string, count: number, noun = 'file'): void {
  const p = palette();
  process.stdout.write(`\n  ${p.BOLD}${verb}${p.RESET} ${count} ${noun}${count === 1 ? '' : 's'}\n\n`);
}

export function footer(verb: string, ok: number, skipped: number, failed: number): void {
  const p = palette();
  if (ok + skipped + failed > 1) {
    process.stdout.write(`\n  ${p.BOLD}summary${p.RESET}    ${ok} ${verb}, ${skipped} skipped, ${failed} failed\n`);
  }
  process.stdout.write('\n');
}

/** The text `die` prints to stderr: a blank line, the status line, a blank line. */
export function dieText(label: string, body: string): string {
  return `\n${msgLine('red', label, body)}\n\n`;
}
