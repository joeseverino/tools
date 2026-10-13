#!/usr/bin/env node
// tools/package-version.ts <package.json>: print the "version" field; exit 1
// with no output when the file or the field is missing.
import { readFileSync } from 'node:fs';
import { isRecord, parseJson } from '../sdk/guards.ts';

export function versionOf(packageJson: unknown): string | null {
  return isRecord(packageJson) && typeof packageJson['version'] === 'string' ? packageJson['version'] : null;
}

if (import.meta.main) {
  let version: string | null = null;
  try {
    version = versionOf(parseJson(readFileSync(process.argv[2] ?? '', 'utf8')));
  } catch {
    version = null;
  }
  if (version === null) {
    process.exitCode = 1;
  } else {
    console.log(version);
  }
}
