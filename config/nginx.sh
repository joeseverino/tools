# shellcheck shell=bash
# config/nginx.sh — Nginx Proxy Manager proxy-host drift checker configuration
#
# Sourced by `nginx`. Each variable can be overridden per-invocation.

: "${KEYS_HOME:?set in ~/.zshrc}"
: "${NOTES_HOME:?set in ~/.zshrc}"

# age-encrypted env holding the NPM web-UI login (NPM has no API tokens at rest;
# nginx exchanges these for a short-lived Bearer per call). Contents:
#   NGINX_EMAIL=...
#   NGINX_PASSWORD=...
# Create with:  encrypt nginx.env   then move the .age here.
: "${NGINX_CREDS:=$KEYS_HOME/nginx/nginx.env.age}"

# Nginx Proxy Manager API base — reachable over LAN or Tailscale; the admin API
# lives under /api on this host (homelab-server VM, admin UI on port 81).
: "${NGINX_URL:=http://192.168.1.233:81/api}"

# Vault doc holding the machine-readable mirror, and the heading whose fenced
# ```json block `diff`/`pull` read and rewrite. The prose table in the same doc
# is for humans; this block is the diff target.
: "${NGINX_VAULT_DOC:=$NOTES_HOME/02 Infrastructure/Nginx Proxy Manager/Proxy Hosts.md}"
: "${NGINX_VAULT_HEADING:=## Canonical Proxy Hosts (nginx)}"
