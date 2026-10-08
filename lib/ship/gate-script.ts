#!/usr/bin/env node
// ship/gate-script.ts <package.json>: name the npm script `ship` gates on:
// "check" if the package defines one, else "test", else nothing. Prints nothing
// when the file is missing or unreadable.
import { readFileSync } from 'node:fs';
import { isRecord, parseJson } from '../sdk/guards.ts';

export function gateScript(packageJson: unknown): string {
  const scripts = isRecord(packageJson) && isRecord(packageJson['scripts']) ? packageJson['scripts'] : {};
  if (scripts['check']) return 'check';
  if (scripts['test']) return 'test';
  return '';
}

if (import.meta.main) {
  try {
    process.stdout.write(gateScript(parseJson(readFileSync(process.argv[2] ?? '', 'utf8'))));
  } catch {
    // unreadable package.json: no gate script
  }
}
