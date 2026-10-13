#!/usr/bin/env node
// tools/next-order.ts: read `tools describe` JSON on stdin and print the next
// free inventory order: the highest `order` rounded up to a multiple of 10, plus 10.
import { text } from 'node:stream/consumers';
import { isRecord, parseJson } from '../sdk/guards.ts';

export function nextOrder(describe: unknown): number {
  const tools = isRecord(describe) && Array.isArray(describe['tools']) ? describe['tools'] : [];
  const max = Math.max(0, ...tools.map((tool) => (isRecord(tool) ? Number(tool['order']) || 0 : 0)));
  return Math.ceil(max / 10) * 10 + 10;
}

if (import.meta.main) process.stdout.write(String(nextOrder(parseJson(await text(process.stdin)))));
