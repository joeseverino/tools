import { errorMessage, isRecord } from './guards.ts';

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

// util.parseArgs rejections are usage errors (exit 2); everything else falls back.
export function exitCodeFor(error: unknown, fallback = 1): number {
  if (error instanceof CliError) return error.exitCode;
  if (isRecord(error) && typeof error['code'] === 'string' && error['code'].startsWith('ERR_PARSE_ARGS')) return 2;
  return fallback;
}

export function reportError(error: unknown, fallback = 1): void {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = exitCodeFor(error, fallback);
}

export async function runCli(main: () => void | Promise<void>, fallback = 1): Promise<void> {
  try {
    await main();
  } catch (error) {
    reportError(error, fallback);
  }
}
