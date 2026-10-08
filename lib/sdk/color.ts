import { styleText } from 'node:util';

export type Style = Parameters<typeof styleText>[0];

const MARK = '\u0000';

// Opening escape for a style, or '' when stdout is not a TTY or colour is
// disabled (NO_COLOR, NODE_DISABLE_COLORS); FORCE_COLOR forces it on.
export function open(style: Style): string {
  return styleText(style, MARK).split(MARK)[0] ?? '';
}

export function paint(style: Style, text: string): string {
  return styleText(style, text);
}
