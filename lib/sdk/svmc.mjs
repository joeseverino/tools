import { runJson } from './process.mjs';

export function svmc(args, options = {}) {
  const { bin: selectedBin, vaultPath: selectedVaultPath, ...runOptions } = options;
  const bin = selectedBin || process.env.SVMC_BIN || 'severino-vault-mcp';
  const vaultPath = selectedVaultPath ?? process.env.SVMC_VAULT_PATH ?? process.env.NOTES_HOME ?? '';
  const result = runJson(bin, args, {
    ...runOptions,
    env: { ...(runOptions.env || {}), SVMC_VAULT_PATH: vaultPath },
  });
  if (result.ok && result.json?.ok === false) {
    const error = typeof result.json.error === 'string'
      ? result.json.error
      : result.json.error?.message || 'governance command failed';
    return { ...result, ok: false, error };
  }
  return result;
}
