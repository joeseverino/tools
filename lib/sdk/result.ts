export const RESULT_VERSION = 1;

export interface ResultError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface Success {
  ok: true;
  result_version: number;
  data: unknown;
  warnings: unknown[];
  receipt: unknown;
  next: unknown[];
}

export interface Failure {
  ok: false;
  result_version: number;
  error: ResultError;
}

export type Result = Success | Failure;

export interface SuccessOptions {
  warnings?: unknown[];
  receipt?: unknown;
  next?: unknown[];
}

export interface FailureOptions {
  retryable?: boolean;
  details?: unknown;
}

export interface WriteOptions {
  pretty?: boolean;
  stream?: NodeJS.WritableStream;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFailure(value: unknown): value is Failure {
  return Boolean(value) && isRecord(value) && value.ok === false && Boolean(value.error) && typeof value.error === 'object';
}

export function success(data: unknown = null, { warnings = [], receipt = null, next = [] }: SuccessOptions = {}): Success {
  return { ok: true, result_version: RESULT_VERSION, data, warnings, receipt, next };
}

export function failure(code: string, message: string, { retryable = false, details }: FailureOptions = {}): Failure {
  const error: ResultError = { code, message, retryable };
  if (details !== undefined) error.details = details;
  return { ok: false, result_version: RESULT_VERSION, error };
}

export function normalizeError(value: unknown, fallbackCode = 'command_failed'): Failure {
  if (isFailure(value)) return value;
  const message = typeof value === 'string'
    ? value
    : (isRecord(value) && (value.error || value.message)) || 'command failed';
  return failure(fallbackCode, String(message));
}

export function writeResult(result: unknown, { pretty = false, stream = process.stdout }: WriteOptions = {}): void {
  stream.write(JSON.stringify(result, null, pretty ? 2 : 0) + '\n');
}
