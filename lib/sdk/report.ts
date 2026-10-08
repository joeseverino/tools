// Health-report plumbing shared by `tools doctor`, `tools check` and `cbm doctor`:
// named checks rendered as status lines or as one JSON object, and gates that run
// another system's own check by exit code.
import { spawnSync } from 'node:child_process';
import { msg, palette } from './output.ts';

export interface CheckEntry {
  label: string;
  ok: boolean;
  warning?: true;
  detail: string;
}

export class CheckReport {
  readonly json: boolean;
  readonly entries: CheckEntry[] = [];

  constructor(json: boolean) {
    this.json = json;
  }

  private detailText(detail: string): string {
    const p = palette();
    return detail ? ` ${p.DIM}(${detail})${p.RESET}` : '';
  }

  /** Records one result; returns false for a failure so callers can accumulate. */
  check(label: string, ok: boolean, detail = ''): boolean {
    if (this.json) this.entries.push({ label, ok, detail });
    else if (ok) msg('green', 'ok', `${label}${this.detailText(detail)}`);
    else msg('red', 'missing', `${label}${this.detailText(detail)}`);
    return ok;
  }

  /** A warning never fails the run. */
  warn(label: string, detail = ''): void {
    if (this.json) this.entries.push({ label, ok: true, warning: true, detail });
    else msg('yellow', 'warn', `${label}${this.detailText(detail)}`);
  }

  /** Runs one system gate; the detail carries the duration and, on failure, the last output line. */
  gate(label: string, command: readonly string[]): boolean {
    const started = Date.now();
    const [bin = '', ...args] = command;
    const result = spawnSync('/bin/sh', ['-c', 'exec "$@" 2>&1', 'gate', bin, ...args], { encoding: 'utf8' });
    const seconds = Math.floor((Date.now() - started) / 1000);
    const code = result.status ?? 1;
    if (code === 0) return this.check(label, true, `${seconds}s`);
    const lines = result.stdout.split('\n');
    const last = lines.map((line) => line.replace(/^\s+/, '')).filter((line) => line !== '').at(-1) ?? '';
    this.check(label, false, `exit ${code} in ${seconds}s — ${last}`);
    if (!this.json) {
      const p = palette();
      for (const line of tail(result.stdout, 6)) process.stdout.write(`             ${p.DIM}${line}${p.RESET}\n`);
    }
    return false;
  }

  /** Prints the verdict (or the JSON object) and returns the exit code. */
  finish(failed: boolean): number {
    if (this.json) {
      process.stdout.write(`${JSON.stringify({ ok: !failed, checks: this.entries })}\n`);
      return failed ? 1 : 0;
    }
    const p = palette();
    process.stdout.write('\n');
    if (failed) {
      process.stdout.write(`  ${p.BOLD}${p.RED}doctor${p.RESET}    one or more checks failed\n\n`);
      return 1;
    }
    process.stdout.write(`  ${p.BOLD}${p.GREEN}doctor${p.RESET}    all checks passed\n\n`);
    return 0;
  }
}

/** The last `count` lines of text, the way tail -n would show them. */
export function tail(text: string, count: number): string[] {
  return text.replace(/\n+$/, '').split('\n').slice(-count);
}
