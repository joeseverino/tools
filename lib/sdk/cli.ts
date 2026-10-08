import { errorMessage, isRecord } from './guards.ts';
import { dieText } from './output.ts';

export class CliError extends Error {
  readonly exitCode: number;
  readonly label: string | undefined;

  /** With a label the error prints as a status line (`die`); without, as bare text. */
  constructor(message: string, exitCode = 1, label?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.label = label;
  }
}

/** Ends the run with this code and prints nothing more; the caller already wrote its output. */
export class SilentExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`exit ${exitCode}`);
    this.name = 'SilentExit';
    this.exitCode = exitCode;
  }
}

export function exit(code: number): never {
  throw new SilentExit(code);
}

export function die(label: string, body: string, exitCode = 1): never {
  throw new CliError(body, exitCode, label);
}

export function usageError(body: string): never {
  return die('usage', body, 2);
}

// util.parseArgs rejections are usage errors (exit 2); everything else falls back.
export function exitCodeFor(error: unknown, fallback = 1): number {
  if (error instanceof CliError || error instanceof SilentExit) return error.exitCode;
  if (isRecord(error) && typeof error['code'] === 'string' && error['code'].startsWith('ERR_PARSE_ARGS')) return 2;
  return fallback;
}

export function reportError(error: unknown, fallback = 1): void {
  if (error instanceof SilentExit) {
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof CliError && error.label !== undefined) process.stderr.write(dieText(error.label, error.message));
  else process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = exitCodeFor(error, fallback);
}

export async function runCli(main: () => void | Promise<void>, fallback = 1): Promise<void> {
  try {
    await main();
  } catch (error) {
    reportError(error, fallback);
  }
}
