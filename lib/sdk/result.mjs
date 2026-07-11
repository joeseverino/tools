export const RESULT_VERSION = 1;

export function success(data = null, { warnings = [], receipt = null, next = [] } = {}) {
  return { ok: true, result_version: RESULT_VERSION, data, warnings, receipt, next };
}

export function failure(code, message, { retryable = false, details } = {}) {
  const error = { code, message, retryable };
  if (details !== undefined) error.details = details;
  return { ok: false, result_version: RESULT_VERSION, error };
}

export function normalizeError(value, fallbackCode = 'command_failed') {
  if (value && value.ok === false && value.error && typeof value.error === 'object') return value;
  const message = typeof value === 'string'
    ? value
    : value?.error || value?.message || 'command failed';
  return failure(fallbackCode, String(message));
}

export function writeResult(result, { pretty = false, stream = process.stdout } = {}) {
  stream.write(JSON.stringify(result, null, pretty ? 2 : 0) + '\n');
}
