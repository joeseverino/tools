# shellcheck shell=bash
# config/adguard.sh — AdGuard Home DNS-rewrite drift checker configuration
#
# Sourced by `adguard`. Each variable can be overridden per-invocation.

: "${KEYS_HOME:?set in ~/.zshrc}"
: "${NOTES_HOME:?set in ~/.zshrc}"

# age-encrypted env holding the AdGuard web-UI credentials (HTTP basic auth):
#   ADGUARD_USER=...
#   ADGUARD_PASS=...
# Create with:  encrypt adguard.env   then move the .age here.
: "${ADGUARD_CREDS:=$KEYS_HOME/adguard/adguard.env.age}"

# AdGuard Home base URL — reachable over LAN or Tailscale; the API lives under
# /control on this host (homelab-server VM, web UI on port 3001).
: "${ADGUARD_URL:=http://192.168.1.233:3001}"

# Vault doc holding the machine-readable mirror, and the heading whose fenced
# ```json block `diff`/`pull` read and rewrite. Prose tables stay for humans.
: "${ADGUARD_VAULT_DOC:=$NOTES_HOME/02 Infrastructure/AdGuard/DNS Rewrites — homelab.md}"
: "${ADGUARD_VAULT_HEADING:=## Canonical Rewrites (adguard)}"
