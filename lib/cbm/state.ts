// Filesystem and process facts about the codebase-memory-mcp daemon.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from '../sdk/process.ts';
import { commandExists } from '../sdk/which.ts';

export interface CbmEnv {
  bin: string;
  cacheDir: string;
  tmpDir: string;
  logDir: string;
  pgrepBin: string;
  uid: number;
}

export function cbmEnv(env: NodeJS.ProcessEnv = process.env, uid = process.getuid?.() ?? 0): CbmEnv {
  const cacheHome = env['XDG_CACHE_HOME'] || path.join(env['HOME'] ?? '', '.cache');
  const cacheDir = env['CBM_CACHE_DIR'] || path.join(cacheHome, 'codebase-memory-mcp');
  return {
    bin: env['CBM_BIN'] || 'codebase-memory-mcp',
    cacheDir,
    tmpDir: env['CBM_TMP_DIR'] || '/tmp',
    logDir: path.join(cacheDir, 'logs'),
    pgrepBin: env['CBM_PGREP_BIN'] || 'pgrep',
    uid,
  };
}

export const REAPER_WARN_DAYS = 2;

const DAY_MS = 86_400_000;
const INIT_RPC =
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cbm-doctor","version":"1"}}}';

export function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Runtime dirs CBM coordinates through: the reaper-exposed /tmp copy, the cache copy, and recovery leftovers. */
export function runtimeDirs(env: CbmEnv): string[] {
  const dirs = [path.join(env.tmpDir, `cbm-daemon-${env.uid}`), path.join(env.cacheDir, 'runtime', `cbm-daemon-${env.uid}`)];
  for (const recovery of names(env.tmpDir).filter((name) => name.startsWith('cbm-recovery-'))) {
    const base = path.join(env.tmpDir, recovery);
    dirs.push(...names(base).filter((name) => name.startsWith('cbm-daemon-')).map((name) => path.join(base, name)));
  }
  return dirs.filter(isDirectory);
}

/** Sockets that lost their identity file: live but unverifiable and unreplaceable. */
export function orphanedSockets(env: CbmEnv): string[] {
  const orphans: string[] = [];
  for (const dir of runtimeDirs(env)) {
    for (const name of names(dir).filter((entry) => entry.endsWith('.sock'))) {
      const sock = path.join(dir, name);
      if (!existsSync(`${sock}.identity`)) orphans.push(sock);
    }
  }
  return orphans;
}

function walkFiles(root: string): string[] {
  const found: string[] = [];
  for (const name of names(root)) {
    const full = path.join(root, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) found.push(...walkFiles(full));
    else if (stat.isFile()) found.push(full);
  }
  return found;
}

/** Whole 24h periods since `mtimeMs` exceed `days`, the way find -mtime +N counts. */
export function olderThanDays(mtimeMs: number, days: number, now = Date.now()): boolean {
  return Math.floor((now - mtimeMs) / DAY_MS) > days;
}

/** Identity files under /tmp nearing the reaper's untouched-for-three-days threshold. */
export function reaperExposed(env: CbmEnv, now = Date.now()): string[] {
  const exposed: string[] = [];
  for (const name of names(env.tmpDir).filter((entry) => entry.startsWith('cbm-daemon-'))) {
    const top = path.join(env.tmpDir, name);
    const files = isDirectory(top) ? walkFiles(top) : [top];
    for (const file of files) {
      if (file.endsWith('.sock.identity') && olderThanDays(statSync(file).mtimeMs, REAPER_WARN_DAYS, now)) exposed.push(file);
    }
  }
  return exposed;
}

export interface WorkerLog {
  path: string;
  size: number;
  mtimeMs: number;
}

export function workerLogs(env: CbmEnv): WorkerLog[] {
  if (!isDirectory(env.logDir)) return [];
  return walkFiles(env.logDir)
    .filter((file) => path.basename(file).startsWith('.worker-log-'))
    .map((file) => ({ path: file, size: statSync(file).size, mtimeMs: statSync(file).mtimeMs }));
}

/** Logs older than `days` whole days; a non-integer day count matches nothing. */
export function staleLogs(logs: readonly WorkerLog[], days: string, now = Date.now()): WorkerLog[] {
  if (!/^[0-9]+$/.test(days)) return [];
  return logs.filter((log) => olderThanDays(log.mtimeMs, Number(days), now));
}

/** Process ids from the stubbable pgrep, minus this process; lookup failure is an empty list. */
export function pgrepPids(env: CbmEnv, pattern: string): string[] {
  const result = run(env.pgrepBin, ['-f', pattern]);
  return result.stdout.split('\n').filter((line) => line !== '');
}

export function cbmPids(env: CbmEnv): string[] {
  return pgrepPids(env, 'codebase-memory-mcp').filter((pid) => pid !== String(process.pid));
}

export function daemonPids(env: CbmEnv): string[] {
  return pgrepPids(env, 'codebase-memory-mcp --cbm-daemon-internal');
}

export type Handshake = 'ok' | 'timeout' | 'fail' | 'missing';

export function handshakeVerdict(exited: boolean, output: string): Handshake {
  if (!exited) return 'timeout';
  return output.includes('"result"') ? 'ok' : 'fail';
}

/** Runs the real MCP initialize handshake, bounded by `secs`. */
export function probe(env: CbmEnv, secs: number): Promise<Handshake> {
  if (!commandExists(env.bin)) return Promise.resolve('missing');
  return new Promise((resolve) => {
    const child = spawn(env.bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const settle = (verdict: Handshake): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      child.kill();
      child.stdout.destroy();
      settle(handshakeVerdict(false, output));
    }, Math.max(0, secs) * 1000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stdin.on('error', () => {});
    child.on('error', () => settle('fail'));
    child.on('close', () => settle(handshakeVerdict(true, output)));
    child.stdin.end(`${INIT_RPC}\n`);
  });
}
