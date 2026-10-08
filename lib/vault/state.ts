// Read-only vault working-tree facts for status surfaces.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from '../sdk/process.ts';

/** "clean" or "<n> uncommitted". */
export function vaultTree(vaultPath: string): string {
  const changed = run('git', ['-C', vaultPath, 'status', '--porcelain']).stdout.split('\n').filter((line) => line !== '').length;
  return changed > 0 ? `${changed} uncommitted` : 'clean';
}

function revCount(vaultPath: string, range: string): number {
  const result = run('git', ['-C', vaultPath, 'rev-list', '--count', range]);
  return result.ok ? Number.parseInt(result.stdout.trim(), 10) || 0 : 0;
}

/** "in sync" or "<ahead>↑ <behind>↓" against the already-fetched upstream. */
export function vaultRemoteLocal(vaultPath: string): string {
  const ahead = revCount(vaultPath, '@{u}..HEAD');
  const behind = revCount(vaultPath, 'HEAD..@{u}');
  return ahead > 0 || behind > 0 ? `${ahead}↑ ${behind}↓` : 'in sync';
}

export function vaultRemote(vaultPath: string): string {
  run('git', ['-C', vaultPath, 'fetch', '--quiet']);
  return vaultRemoteLocal(vaultPath);
}

/** Number of top-level *.md files in the inbox (0 when it is missing). */
export function inboxCount(inboxPath: string): number {
  try {
    return readdirSync(inboxPath).filter((name) => name.endsWith('.md') && statSync(path.join(inboxPath, name)).isFile()).length;
  } catch {
    return 0;
  }
}
