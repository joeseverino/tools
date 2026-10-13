// hq's configuration (config/hq.sh, overridable per variable from the
// environment) and the small jq-compatible value helpers its reports share.
import { die } from '../sdk/cli.ts';
import { loadShellConfig } from '../sdk/config.ts';
import { isRecord } from '../sdk/guards.ts';
import { codeHome } from '../sdk/paths.ts';

export interface HqEnv {
  vault: string;
  localPath: string;
  schemaDoc: string;
  sshHost: string;
  remotePath: string;
  url: string;
  envItem: string;
  envVault: string;
}

let cached: HqEnv | undefined;

export function loadHqEnv(): HqEnv {
  cached ??= readHqEnv();
  return cached;
}

function readHqEnv(): HqEnv {
  process.env['CODE_HOME'] ??= codeHome;
  const { scalars } = loadShellConfig('hq', {
    scalars: ['VAULT', 'HQ_LOCAL_PATH', 'HQ_SCHEMA_DOC', 'HQ_SSH_HOST', 'HQ_REMOTE_PATH', 'HQ_URL', 'HQ_ENV_ITEM', 'HQ_ENV_VAULT'],
  });
  const get = (name: string): string => scalars[name] ?? '';
  return {
    vault: get('VAULT'),
    localPath: get('HQ_LOCAL_PATH'),
    schemaDoc: get('HQ_SCHEMA_DOC'),
    sshHost: get('HQ_SSH_HOST'),
    remotePath: get('HQ_REMOTE_PATH'),
    url: get('HQ_URL'),
    envItem: get('HQ_ENV_ITEM'),
    envVault: get('HQ_ENV_VAULT'),
  };
}

export function requireAdmin(env: HqEnv): void {
  if (!env.sshHost) die('error', 'HQ_SSH_HOST is required for host administration');
  if (!env.remotePath) die('error', 'HQ_REMOTE_PATH is required for host administration');
}

/** A value as `jq -r` prints it: strings raw, everything else as compact JSON. */
export function jqText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

/** jq's `length`: element count, key count, string length, absolute value, 0 for null. */
export function jqLength(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return [...value].length;
  if (typeof value === 'number') return Math.abs(value);
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return 0;
}

export function resultOk(result: unknown): boolean {
  return isRecord(result) && jqText(result['ok']) === 'true';
}

/** `.error.message // fallback` over a tool result; empty when the result is not an object. */
export function failureMessage(result: unknown, fallback: string): string {
  if (result === null) return fallback;
  if (!isRecord(result)) return '';
  const error = result['error'];
  if (error === undefined || error === null) return fallback;
  if (!isRecord(error)) return '';
  const message = error['message'];
  return message === undefined || message === null || message === false ? fallback : jqText(message);
}
