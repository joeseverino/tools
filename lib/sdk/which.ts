import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

function executableFile(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The path `command -v` would resolve: a path as given, or a bare name looked up through PATH. */
export function which(bin: string, searchPath = process.env['PATH'] ?? ''): string | null {
  if (bin.includes('/')) return executableFile(bin) ? bin : null;
  for (const dir of searchPath.split(':')) {
    const candidate = path.join(dir === '' ? '.' : dir, bin);
    if (executableFile(candidate)) return candidate;
  }
  return null;
}

export function commandExists(bin: string): boolean {
  return which(bin) !== null;
}
