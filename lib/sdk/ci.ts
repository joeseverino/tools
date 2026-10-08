// The CI-equivalent environment: this checkout's bin first with the install dir
// off PATH, so a stale installed symlink never shadows repo code, and an empty
// git config, so the operator's aliases, hooks and init.defaultBranch cannot leak.
// lib/sdk/ci.sh is the shell twin used by the bats harness.
import os from 'node:os';
import path from 'node:path';
import { toolsHome } from './paths.ts';

/** `source` (default PATH) without any segment equal to `drop`; empty segments are dropped. */
export function pathWithout(drop: string, source = process.env['PATH'] ?? ''): string {
  return source
    .split(':')
    .filter((segment) => segment !== '' && segment !== drop)
    .join(':');
}

export function ciPath(home = toolsHome, source = process.env['PATH'] ?? '', installDir = process.env['TOOLS_INSTALL_DIR'] || path.join(os.homedir(), '.local/bin')): string {
  const bin = `${home.replace(/\/+$/, '')}/bin`;
  return `${bin}:${pathWithout(installDir, pathWithout(bin, source))}`;
}

/** Applies the CI environment to this process and every child it spawns. */
export function applyCiEnv(home = toolsHome): void {
  process.env['PATH'] = ciPath(home);
  process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
  process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
}
