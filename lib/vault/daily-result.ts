#!/usr/bin/env node
// vault/daily-result.ts: fold the MCP's daily-write {ok,...} envelope on stdin
// into one tab record for the shell:
//   ok <TAB> <path wrote> <TAB> created|updated
//   err <TAB> <message>
import { text } from 'node:stream/consumers';
import { isRecord, parseJson } from '../sdk/guards.ts';

export function dailyRecord(envelope: unknown): string {
  const result = isRecord(envelope) ? envelope : {};
  if (result['ok']) return `ok\t${String(result['wrote'] || '')}\t${result['created'] ? 'created' : 'updated'}`;
  return `err\t${String(result['error'] || 'failed')}`;
}

if (import.meta.main) process.stdout.write(dailyRecord(parseJson(await text(process.stdin))));
