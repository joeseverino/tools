# shellcheck shell=bash
# Logical secret resolution for Tools and sibling consumers.
#
# Callers know stable logical ids only. This module owns registry lookup,
# provider invocation, schema validation, and safe errors. Secret values are
# emitted only on stdout for immediate capture.

TOOLS_SECRETS_REGISTRY="${TOOLS_SECRETS_REGISTRY:-${TOOLS_HOME:?}/config/secrets.json}"
TOOLS_SECRETS_SCHEMA="${TOOLS_SECRETS_SCHEMA:-${TOOLS_HOME:?}/schemas/secrets-v1.json}"

secrets_registry_check() {
    node "$TOOLS_HOME/lib/tools/validate-json.mjs" \
        "$TOOLS_SECRETS_SCHEMA" < "$TOOLS_SECRETS_REGISTRY" >/dev/null 2>&1
}

secret_ref() {
    local id="$1" ref
    [[ -f "$TOOLS_SECRETS_REGISTRY" ]] \
        || die "error" "secrets registry not found: $TOOLS_SECRETS_REGISTRY"
    secrets_registry_check \
        || die "error" "secrets registry does not match schemas/secrets-v1.json"
    ref=$(jq -er --arg id "$id" '.secrets[$id] // empty' "$TOOLS_SECRETS_REGISTRY" 2>/dev/null) \
        || die "error" "unknown secret id: $id"
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

secrets_inventory() {
    secrets_registry_check \
        || die "error" "secrets registry does not match schemas/secrets-v1.json"
    jq -r '.secrets | keys[]' "$TOOLS_SECRETS_REGISTRY"
}
