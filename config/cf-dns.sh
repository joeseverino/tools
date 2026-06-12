# shellcheck shell=bash
# config/cf-dns.sh — Cloudflare DNS drift checker configuration
#
# Sourced by `cf-dns`. Each variable can be overridden per-invocation.

: "${KEYS_HOME:?set in ~/.zshrc}"
: "${NOTES_HOME:?set in ~/.zshrc}"

# age-encrypted env file holding a Cloudflare API token. Contents:
#   CF_API_TOKEN=...
# The token needs Zone.DNS:Read on the zone, plus Zone:Read so cf-dns can
# resolve the zone id from CF_ZONE (skip the latter by pinning CF_ZONE_ID).
# Create with:  encrypt cf-dns.env   then move the .age here.
: "${CF_DNS_CREDS:=$KEYS_HOME/cloudflare/cf-dns.env.age}"

# Zone to query. cf-dns resolves the id from the name unless CF_ZONE_ID is set.
: "${CF_ZONE:=jseverino.com}"
: "${CF_ZONE_ID:=}"

# Vault doc holding the machine-readable mirror, and the heading whose fenced
# ```json block `diff`/`pull` read and rewrite. The prose tables in the same
# doc are for humans; this block is the diff target.
: "${CF_DNS_VAULT_DOC:=$NOTES_HOME/02 Infrastructure/Cloudflare/DNS Records — jseverino.com.md}"
: "${CF_DNS_VAULT_HEADING:=## Canonical Records (cf-dns)}"
