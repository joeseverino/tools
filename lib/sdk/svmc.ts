import { runJson } from './process.ts';
import type { JsonRunResult, RunOptions } from './process.ts';

export interface SvmcOptions extends RunOptions {
  bin?: string;
  vaultPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function svmc(args: string[], options: SvmcOptions = {}): JsonRunResult {
  const { bin: selectedBin, vaultPath: selectedVaultPath, ...runOptions } = options;
  const bin = selectedBin || process.env.SVMC_BIN || 'severino-vault-mcp';
  const vaultPath = selectedVaultPath ?? process.env.SVMC_VAULT_PATH ?? process.env.NOTES_HOME ?? '';
  const result = runJson(bin, args, {
    ...runOptions,
    env: { ...(runOptions.env || {}), SVMC_VAULT_PATH: vaultPath },
  });
  const json = result.json;
  if (result.ok && isRecord(json) && json.ok === false) {
    const error = typeof json.error === 'string'
      ? json.error
      : (isRecord(json.error) && json.error.message) || 'governance command failed';
    return { ...result, ok: false, error: String(error) };
  }
  return result;
}
