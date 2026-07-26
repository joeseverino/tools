# shellcheck shell=bash
# config/cf-dns.sh — Cloudflare DNS drift checker configuration
#
# Sourced by `cf-dns`. Each variable can be overridden per-invocation.

: "${NOTES_HOME:?set in ~/.zshrc}"

# Zone to query. cf-dns resolves the id from the name unless CF_ZONE_ID is set.
: "${CF_ZONE:=jseverino.com}"
: "${CF_ZONE_ID:=}"

# Vault doc holding the machine-readable mirror, and the heading whose fenced
# ```json block `diff`/`pull` read and rewrite. The prose tables in the same
# doc are for humans; this block is the diff target.
: "${CF_DNS_VAULT_DOC:=$NOTES_HOME/02 Infrastructure/Cloudflare/DNS Records — jseverino.com.md}"
: "${CF_DNS_VAULT_HEADING:=## Canonical Records (cf-dns)}"
