// Pure parsing, statistics and formatting for dns-test.

/** printf("%.<digits>f") semantics: the exact binary value is rounded, ties to even. */
export function formatFixed(value: number, digits: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const exact = Math.abs(value).toFixed(60);
  const [whole = '0', fraction = ''] = exact.split('.');
  let scaled = BigInt(whole + fraction.slice(0, digits));
  const tail = fraction.slice(digits);
  const half = `5${'0'.repeat(tail.length - 1)}`;
  if (tail > half || (tail === half && scaled % 2n === 1n)) scaled += 1n;
  const text = scaled.toString().padStart(digits + 1, '0');
  const body = digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return negative ? `-${body}` : body;
}

/** awk's `printf "%+7.1f"`. */
export function signedFixed(value: number, width: number, digits: number): string {
  const body = formatFixed(value, digits);
  return (body.startsWith('-') ? body : `+${body}`).padStart(width);
}

/** The Query time in ms from `dig` output, or null when absent. */
export function parseQueryTime(output: string): string | null {
  for (const line of output.split('\n')) {
    if (line.includes('Query time')) return line.trim().split(/\s+/)[3] ?? '';
  }
  return null;
}

/** Whole milliseconds from curl's time_total seconds. */
export function dohMillis(timeTotal: string): string {
  return formatFixed(Number(timeTotal) * 1000, 0);
}

export function isWholeNumber(text: string): boolean {
  return /^[0-9]+$/.test(text);
}

function percentile(sorted: readonly number[], p: number): number {
  const count = sorted.length;
  const index = Math.min(Math.max(Math.trunc(p * count + 0.9999), 1), count);
  return sorted[index - 1] ?? 0;
}

/** "avg min p50 p95 max ok/total", or N/A columns when nothing succeeded. */
export function summarize(want: string, times: readonly number[]): string {
  if (times.length === 0) return `N/A N/A N/A N/A N/A 0/${want}`;
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? 0;
  const fields = [formatFixed(sum / sorted.length, 1), first, percentile(sorted, 0.5), percentile(sorted, 0.95), last];
  return `${fields.join(' ')} ${times.length}/${want}`;
}

export interface GetoptsResult {
  domain?: string;
  runs?: string;
  adguard?: string;
  baseline?: string;
  help: boolean;
  /** Set when parsing stopped on a bad option: unknown flag character or a missing value. */
  error?: { kind: 'unknown'; option: string } | { kind: 'missing'; option: string };
}

/** Emulates `getopts ":d:n:a:b:h"`: leading option clusters only, the rest is ignored. */
export function getopts(args: readonly string[]): GetoptsResult {
  const result: GetoptsResult = { help: false };
  const withValue: Record<string, 'domain' | 'runs' | 'adguard' | 'baseline'> = { d: 'domain', n: 'runs', a: 'adguard', b: 'baseline' };
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? '';
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') break;
    index += 1;
    for (let pos = 1; pos < arg.length; pos += 1) {
      const flag = arg.charAt(pos);
      const key = withValue[flag];
      if (key) {
        const attached = arg.slice(pos + 1);
        if (attached !== '') result[key] = attached;
        else if (index < args.length) {
          result[key] = args[index] ?? '';
          index += 1;
        } else return { ...result, error: { kind: 'missing', option: flag } };
        break;
      }
      if (flag === 'h') {
        result.help = true;
        return result;
      }
      return { ...result, error: { kind: 'unknown', option: flag } };
    }
  }
  return result;
}

const ROW_HEADER = ['Path', 'Avg', 'Min', 'p50', 'p95', 'Max', 'OK/Total'];

function table(label: string, cells: readonly string[]): string {
  const [avg = '', min = '', p50 = '', p95 = '', max = '', ok = ''] = cells;
  return `${label.padEnd(22)} ${avg.padStart(8)} ${min.padStart(8)} ${p50.padStart(8)} ${p95.padStart(8)} ${max.padStart(8)} ${ok.padStart(10)}`;
}

export function tableHeader(): string {
  const [path = '', ...rest] = ROW_HEADER;
  return `${table(path, rest)}\n${'-'.repeat(80)}`;
}

/** One table row from a summarize() string. */
export function tableRow(label: string, summary: string): string {
  const [avg = '', min = '', p50 = '', p95 = '', max = '', ok = ''] = summary.split(/\s+/);
  if (avg === 'N/A') return table(label, ['N/A', 'N/A', 'N/A', 'N/A', 'N/A', ok]);
  return table(label, [avg, min, p50, p95, max].map((value) => `${value.padStart(6)}ms`).concat(ok));
}

/** "  <label>  +1.5 ms (slower)" for a path against the baseline average. */
export function deltaLine(label: string, avg: string, baseAvg: string): string {
  const delta = Number(avg) - Number(baseAvg);
  return `  ${label.padEnd(22)} ${signedFixed(delta, 7, 1)} ms (${delta >= 0 ? 'slower' : 'faster'})`;
}
