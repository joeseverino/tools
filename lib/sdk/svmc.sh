# shellcheck shell=bash
# The ONE shell crossing into the vault governance CLI (the vault's
# schema-validated, atomic reader/writer). Every tool routes through here — no
# inline call sites — so the vault pin and the binary name ($SVMC_BIN; tests
# stub it, mirroring the drift guards' $DRIFT_REVIEW_BIN seam) live in one place.

svmc_bin() { printf '%s' "${SVMC_BIN:-severino-vault-mcp}"; }

svmc_available() { command -v "$(svmc_bin)" >/dev/null 2>&1; }

# Vault precedence: an explicit SVMC_VAULT_PATH (a call-site override, e.g.
# hq-state.sh checking a named vault) wins over the $NOTES_HOME pin that
# exists to defeat the MCP's own default-vault fallback. Corollary: an
# *inherited* SVMC_VAULT_PATH wins too — never export it from a profile, or
# every tool silently reads that vault instead of $NOTES_HOME.
svmc() {
    SVMC_VAULT_PATH="${SVMC_VAULT_PATH:-${NOTES_HOME:-}}" "$(svmc_bin)" "$@"
}
