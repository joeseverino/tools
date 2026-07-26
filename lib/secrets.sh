# shellcheck shell=bash
# secrets.sh — the sole runtime boundary between Tools and 1Password.
#
# Callers ask for a logical id. This module alone owns registry lookup, provider
# invocation, and safe errors. Production has one provider; tests shadow `op`
# on PATH. Secret values are emitted only on stdout for immediate capture.

TOOLS_SECRETS_REGISTRY="${TOOLS_SECRETS_REGISTRY:-${TOOLS_HOME:?}/config/secrets.json}"

secret_ref() {
    local id="$1" ref
    [[ -f "$TOOLS_SECRETS_REGISTRY" ]] \
        || die "error" "secrets registry not found: $TOOLS_SECRETS_REGISTRY"
    ref=$(jq -er --arg id "$id" '.secrets[$id] // empty' "$TOOLS_SECRETS_REGISTRY" 2>/dev/null) \
        || die "error" "unknown secret id: $id"
    [[ $ref == op://* ]] || die "error" "invalid 1Password reference for: $id"
    printf '%s' "$ref"
}

secret_read() {
    local id="$1" ref
    command -v op >/dev/null 2>&1 \
        || die "error" "1Password CLI not installed (run: tools bootstrap)"
    ref=$(secret_ref "$id")
    op read --no-newline "$ref" 2>/dev/null \
        || die "error" "could not read $id from 1Password (unlock the app and try again)"
}

secrets_registry_check() {
    jq -e '
      .schema_version == 1 and
      .provider == "1password" and
      (.secrets | type == "object" and length > 0) and
      ([.secrets[] | type == "string" and startswith("op://")] | all)
    ' "$TOOLS_SECRETS_REGISTRY" >/dev/null 2>&1
}

secrets_inventory() {
    jq -r '.secrets | keys[]' "$TOOLS_SECRETS_REGISTRY"
}
