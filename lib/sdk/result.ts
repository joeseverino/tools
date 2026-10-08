// The versioned result envelope for agent-facing utilities; the shape is pinned
// by schemas/result-v1.json.
export interface ResultOptions {
  warnings?: readonly string[];
  receipt?: unknown;
  next?: readonly unknown[];
}

export function resultOk(data: unknown = null, options: ResultOptions = {}): string {
  return `${JSON.stringify({
    ok: true,
    result_version: 1,
    data,
    warnings: options.warnings ?? [],
    receipt: options.receipt ?? null,
    next: options.next ?? [],
  })}\n`;
}

export function resultError(code: string, message: string, retryable = false, details?: unknown): string {
  return `${JSON.stringify({
    ok: false,
    result_version: 1,
    error: { code, message, retryable, ...(details === undefined ? {} : { details }) },
  })}\n`;
}
