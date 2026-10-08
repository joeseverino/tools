#!/usr/bin/env node
// backlog/result.ts: fold the MCP's task-write {ok,...} envelope on stdin into
// one tab record for the shell; exits 1 on an error envelope:
//   ok <TAB> doc_id <TAB> status <TAB> previous <TAB> relative_path
//   err <TAB> <message>
import { text } from 'node:stream/consumers';
import { isRecord, parseJson } from '../sdk/guards.ts';

export function taskRecord(envelope: unknown): { line: string; ok: boolean } {
  const result = isRecord(envelope) ? envelope : {};
  if (result['ok']) {
    const cells = ['doc_id', 'status', 'previous', 'relative_path'].map((key) => String(result[key] || ''));
    return { line: ['ok', ...cells].join('\t'), ok: true };
  }
  return { line: `err\t${String(result['error'] || 'failed')}`, ok: false };
}

if (import.meta.main) {
  const { line, ok } = taskRecord(parseJson(await text(process.stdin)));
  process.stdout.write(line);
  if (!ok) process.exitCode = 1;
}
