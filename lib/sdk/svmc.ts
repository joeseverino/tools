// The one Node crossing into the vault governance CLI. SVMC_BIN names the
// binary (tests stub it). The vault is pinned to NOTES_HOME unless
// SVMC_VAULT_PATH is already set, so a call can never fall back to the MCP's own
// default vault.
import { run } from './process.ts';
import type { RunResult } from './process.ts';
import { commandExists } from './which.ts';

export function svmcBin(): string {
  return process.env['SVMC_BIN'] || 'severino-vault-mcp';
}

export function svmcAvailable(): boolean {
  return commandExists(svmcBin());
}

export interface SvmcOptions {
  /** Stdin for the call. */
  input?: string;
  /** Overrides the vault pin for this call (a named vault check). */
  vaultPath?: string;
}

export function svmc(args: readonly string[], options: SvmcOptions = {}): RunResult {
  const vault = options.vaultPath ?? (process.env['SVMC_VAULT_PATH'] || process.env['NOTES_HOME'] || '');
  return run(svmcBin(), [...args], {
    env: { SVMC_VAULT_PATH: vault },
    ...(options.input === undefined ? {} : { input: options.input }),
  });
}
