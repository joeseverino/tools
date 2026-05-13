# shellcheck shell=bash
# vault.sh — defaults for the vault and inbox tools.
#
# Derives from NOTES_HOME exported by ~/.zshrc. No duplicated paths —
# single source of truth lives in the shell config.
#
# Per-invocation override: VAULT / INBOX_DIR env vars.

: "${NOTES_HOME:?set in ~/.zshrc}"
: "${VAULT:=$NOTES_HOME}"
: "${INBOX_DIR:=$VAULT/00 Inbox}"
