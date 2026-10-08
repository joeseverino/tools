import { spawn, spawnSync } from 'node:child_process';
import type { SpawnOptions, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import { errorMessage } from './guards.ts';

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

export type Guard<T> = (value: unknown) => value is T;

export interface JsonRunResult<T = unknown> extends RunResult {
  json: T | null;
}

export interface SpawnJsonResult<T = unknown> extends Omit<JsonRunResult<T>, 'code'> {
  code: number | null;
}

function decode(bin: string, stdout: string, validate: Guard<unknown> | undefined): { json: unknown } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout || 'null');
  } catch (error) {
    return { error: `${bin}: invalid JSON: ${errorMessage(error)}` };
  }
  if (!validate) return { json: parsed };
  return validate(parsed) ? { json: parsed } : { error: `${bin}: unexpected JSON shape` };
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

export function runJson(bin: string, args?: string[], options?: RunOptions): JsonRunResult;
export function runJson<T>(bin: string, args: string[], options: RunOptions, validate: Guard<T>): JsonRunResult<T>;
export function runJson(bin: string, args: string[] = [], options: RunOptions = {}, validate?: Guard<unknown>): JsonRunResult {
  const result = run(bin, args, options);
  if (!result.ok) return { ...result, json: null };
  const decoded = decode(bin, result.stdout, validate);
  return 'error' in decoded ? { ...result, ok: false, json: null, error: decoded.error } : { ...result, json: decoded.json };
}

export function spawnJson(bin: string, args?: string[], options?: SpawnJsonOptions): Promise<SpawnJsonResult>;
export function spawnJson<T>(bin: string, args: string[], options: SpawnJsonOptions, validate: Guard<T>): Promise<SpawnJsonResult<T>>;
export function spawnJson(bin: string, args: string[] = [], options: SpawnJsonOptions = {}, validate?: Guard<unknown>): Promise<SpawnJsonResult> {
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
      const decoded = decode(bin, stdout, validate);
      resolve('error' in decoded ? { ...base, ok: false, json: null, error: decoded.error } : { ...base, json: decoded.json });
    });
  });
}
