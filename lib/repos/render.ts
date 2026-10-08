// The human `repos` table.
import { palette } from '../sdk/output.ts';
import type { Pr } from './pr.ts';
import type { ParsedRecord } from './record.ts';

const NAME_WIDTH = 22;
const SUBJECT_WIDTH = 42;

function clip(text: string, width: number): string {
  const chars = Array.from(text);
  return chars.length > width ? `${chars.slice(0, width - 1).join('')}…` : text;
}

function pad(text: string, width: number): string {
  const length = Array.from(text).length;
  return length < width ? text + ' '.repeat(width - length) : text;
}

export function statusText(rec: ParsedRecord): string {
  const parts: string[] = [];
  if (!rec.has_remote && !rec.local_ok) parts.push('local');
  if (!rec.has_remote && rec.local_ok) parts.push('local-ok');
  if (rec.dirty > 0) parts.push(`±${rec.dirty}`);
  if (rec.untracked > 0) parts.push(`?${rec.untracked}`);
  if (rec.ahead > 0) parts.push(`↑${rec.ahead}`);
  if (rec.behind > 0) parts.push(`↓${rec.behind}`);
  if (rec.stash > 0) parts.push(`⚑${rec.stash}`);
  if (rec.upstream_gone) parts.push('gone');
  return parts.join(' ') || 'clean';
}

/** Table rows plus the summary line; `prs` is aligned with `records` when PR columns are shown. */
export function renderTable(records: readonly ParsedRecord[], prs: readonly Pr[] | null): string {
  const p = palette();
  let out = prs
    ? `  ${p.BOLD}${pad('REPO', NAME_WIDTH)} ${pad('ROOT', 9)} ${pad('PM', 6)} ${pad('STATUS', 17)} ${pad('CI', 4)} ${pad('PR', 13)} LAST COMMIT${p.RESET}\n`
    : `  ${p.BOLD}${pad('REPO', NAME_WIDTH)} ${pad('ROOT', 9)} ${pad('PM', 6)} ${pad('STATUS', 17)} ${pad('CI', 4)} LAST COMMIT${p.RESET}\n`;
  let dirty = 0;
  let unpushed = 0;
  records.forEach((rec, index) => {
    const status = statusText(rec);
    if (rec.dirty + rec.untracked > 0) dirty += 1;
    if (rec.needs_attention) unpushed += 1;
    const ci = rec.ci === 0 ? '-' : String(rec.ci);
    const color = status === 'clean' ? p.RESET : p.YELLOW;
    let line = `  ${pad(clip(rec.name, NAME_WIDTH), NAME_WIDTH)} ${pad(rec.root, 9)} ${pad(rec.pm, 6)} ${color}${pad(status, 17)}${p.RESET} ${pad(ci, 4)} `;
    const pr = prs?.[index];
    if (prs) {
      let label = '-';
      let tone = p.DIM;
      if (pr && pr.state !== 'none') {
        label = `#${pr.number} ${pr.ci}`;
        if (pr.ci === 'passing') tone = p.GREEN;
        else if (pr.ci === 'failing') tone = p.RED;
        else if (pr.ci === 'pending') tone = p.YELLOW;
      }
      line += `${tone}${pad(label, 13)}${p.RESET} `;
    }
    out += `${line}${rec.date || '-'} ${clip(rec.subject, SUBJECT_WIDTH)}\n`;
  });
  return `${out}\n${`  ${p.DIM}${p.BOLD}${'summary'.padEnd(10)}${p.RESET} ${records.length} repos · ${dirty} dirty · ${unpushed} unpushed`}\n\n`;
}
