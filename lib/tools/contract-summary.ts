#!/usr/bin/env node
// tools/contract-summary.ts <ok|detail> '<contracts --json output>': the two
// facts `tools doctor` reports about the contract graph: "1"/"0" for ok, and
// "N current, M unavailable" for the detail line. Exits 1 on malformed input.
import { isRecord } from '../sdk/guards.ts';
import type { JsonRecord } from '../sdk/guards.ts';

export function summarize(report: unknown): { ok: boolean; detail: string } {
  if (!isRecord(report) || !Array.isArray(report['projections']) || !report['projections'].every(isRecord)) {
    throw new Error('not a contracts report');
  }
  const projections: JsonRecord[] = report['projections'];
  const current = projections.filter((p) => p['ok'] && !p['skipped']).length;
  const unavailable = projections.filter((p) => p['skipped']).length;
  return { ok: Boolean(report['ok']), detail: `${current} current, ${unavailable} unavailable` };
}

if (import.meta.main) {
  const [field, raw = ''] = process.argv.slice(2);
  try {
    const { ok, detail } = summarize(JSON.parse(raw));
    if (field === 'ok') process.stdout.write(ok ? '1' : '0');
    else if (field === 'detail') process.stdout.write(detail);
    else throw new Error('usage: contract-summary.ts <ok|detail> <json>');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
