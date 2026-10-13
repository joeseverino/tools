// What `hq sync` shipped, recorded so `hq doctor` and `vault status` can tell
// exactly when the vault's manifest has moved past it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isRecord, parseJson } from '../sdk/guards.ts';
import { svmc, svmcAvailable } from '../sdk/svmc.ts';

export function syncStateFile(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['XDG_STATE_HOME'] || path.join(env['HOME'] ?? '', '.local/state');
  return path.join(base, 'severino-tools/hq-sync.json');
}

export type Freshness = { kind: 'never' | 'skip' } | { kind: 'fresh' | 'stale'; date: string };

export interface SyncRecord {
  sha: string;
  dirs: string;
  synced: string;
  vault: string;
}

export function readRecord(text: string): SyncRecord | null {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) return null;
  const field = (key: string): string => {
    const value = parsed[key];
    return typeof value === 'string' ? value : '';
  };
  return { sha: field('manifest_sha256'), dirs: field('vault_dirs'), synced: field('synced_at'), vault: field('vault') };
}

/** Hash the way `hq sync` recorded it: the manifest text with one trailing newline. */
export function manifestHash(manifest: string): string {
  return createHash('sha256').update(`${manifest.replace(/\n+$/, '')}\n`).digest('hex');
}

export function compareRecord(record: SyncRecord, current: string): Freshness {
  const date = record.synced.split('T')[0] ?? '';
  return current === record.sha ? { kind: 'fresh', date } : { kind: 'stale', date };
}

/** Compares the vault's manifest now against the one the last successful sync recorded. */
export function syncFreshness(vaultPath: string): Freshness {
  let text: string;
  try {
    text = readFileSync(syncStateFile(), 'utf8');
  } catch {
    return { kind: 'never' };
  }
  if (!svmcAvailable()) return { kind: 'skip' };
  const record = readRecord(text);
  if (!record || !record.sha || !record.dirs || record.vault !== vaultPath) return { kind: 'skip' };
  const args = record.dirs === 'mcp-default' ? ['hq-manifest', vaultPath] : ['hq-manifest', vaultPath, record.dirs];
  const result = svmc(args, { vaultPath });
  const manifest = result.stdout.replace(/\n+$/, '');
  if (!result.ok || !manifest) return { kind: 'skip' };
  return compareRecord(record, manifestHash(manifest));
}
