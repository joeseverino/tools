# shellcheck shell=bash
# The one shell crossing into the vault governance CLI.

svmc_bin() { printf '%s' "${SVMC_BIN:-severino-vault-mcp}"; }

svmc_available() { command -v "$(svmc_bin)" >/dev/null 2>&1; }

svmc() {
    SVMC_VAULT_PATH="${SVMC_VAULT_PATH:-${NOTES_HOME:-}}" "$(svmc_bin)" "$@"
}
