// hq's configuration (config/hq.sh, overridable per variable from the
// environment) and the jq-compatible value helpers its reports share.
import { loadShellConfig } from '../sdk/config.ts';
import { isRecord } from '../sdk/guards.ts';
import { codeHome } from '../sdk/paths.ts';

export interface HqEnv {
  vault: string;
  localPath: string;
  schemaDoc: string;
}

let cached: HqEnv | undefined;

export function loadHqEnv(): HqEnv {
  cached ??= readHqEnv();
  return cached;
}

// The transport (lib/hq-call) reads its host and container from the
// environment, so a value set only in config/hq.sh is passed on to it.
const TRANSPORT = ['HQ_SSH_HOST', 'HQ_CONTAINER'] as const;

function readHqEnv(): HqEnv {
  process.env['CODE_HOME'] ??= codeHome;
  const { scalars } = loadShellConfig('hq', {
    scalars: ['VAULT', 'HQ_LOCAL_PATH', 'HQ_SCHEMA_DOC', ...TRANSPORT],
  });
  const get = (name: string): string => scalars[name] ?? '';
  for (const name of TRANSPORT) if (get(name)) process.env[name] = get(name);
  return {
    vault: get('VAULT'),
    localPath: get('HQ_LOCAL_PATH'),
    schemaDoc: get('HQ_SCHEMA_DOC'),
  };
}

/** A value as `jq -r` prints it: strings raw, everything else as compact JSON. */
export function jqText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
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
