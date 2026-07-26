# shellcheck shell=bash
# config/ts-acl.sh — Tailscale ACL drift checker configuration
#
# Sourced by `ts-acl`. Each variable can be overridden per-invocation.

: "${NOTES_HOME:?set in ~/.zshrc}"

# Tailnet to query. "-" means the default tailnet of the credential.
: "${TS_TAILNET:=-}"

# Vault doc whose fenced ```json ACL block is the stored mirror, used by `diff`.
: "${TS_ACL_VAULT_DOC:=$NOTES_HOME/02 Infrastructure/Tailscale/ACL Policy.md}"
