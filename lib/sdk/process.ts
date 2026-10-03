import { spawn, spawnSync } from 'node:child_process';
import type { SpawnOptions, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';

export type RunOptions = Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'>;
export type SpawnJsonOptions = Omit<SpawnOptions, 'stdio'>;

export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  error: string;
  command: string[];
}

export interface JsonRunResult extends RunResult {
  json: unknown;
}

export interface SpawnJsonResult extends Omit<JsonRunResult, 'code'> {
  code: number | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcome(proc: SpawnSyncReturns<string>, bin: string, args: string[]): RunResult {
  const code = proc.status ?? (proc.error ? 1 : 0);
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';
  return {
    ok: code === 0 && !proc.error,
    code,
    stdout,
    stderr,
    error: proc.error ? `${bin}: ${proc.error.message}` : code === 0 ? '' : stderr.trim() || stdout.trim() || `${bin} exited ${code}`,
    command: [bin, ...args],
  };
}

export function run(bin: string, args: string[] = [], options: RunOptions = {}): RunResult {
  const proc = spawnSync(bin, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
  return outcome(proc, bin, args);
}

export function runJson(bin: string, args: string[] = [], options: RunOptions = {}): JsonRunResult {
  const result = run(bin, args, options);
  if (!result.ok) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.stdout || 'null') };
  } catch (error) {
    return { ...result, ok: false, json: null, error: `${bin}: invalid JSON: ${message(error)}` };
  }
}

export function spawnJson(bin: string, args: string[] = [], options: SpawnJsonOptions = {}): Promise<SpawnJsonResult> {
  const child = spawn(bin, args, {
    ...options,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => resolve({ ok: false, code: 1, stdout, stderr, json: null, error: `${bin}: ${error.message}`, command: [bin, ...args] }));
    child.on('close', (code) => {
      const base = { ok: code === 0, code, stdout, stderr, error: code === 0 ? '' : stderr.trim() || stdout.trim() || `${bin} exited ${code}`, command: [bin, ...args] };
      if (!base.ok) return resolve({ ...base, json: null });
      try { resolve({ ...base, json: JSON.parse(stdout || 'null') }); }
      catch (error) { resolve({ ...base, ok: false, json: null, error: `${bin}: invalid JSON: ${message(error)}` }); }
    });
  });
}
