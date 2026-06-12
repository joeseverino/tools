# shellcheck shell=bash
# config/ts-acl.sh — Tailscale ACL drift checker configuration
#
# Sourced by `ts-acl`. Each variable can be overridden per-invocation.

: "${KEYS_HOME:?set in ~/.zshrc}"
: "${NOTES_HOME:?set in ~/.zshrc}"

# age-encrypted env file holding credentials. Either a plain API access token:
#   TS_API_TOKEN=tskey-api-...
# or (preferred, read-only) an OAuth client:
#   TS_OAUTH_CLIENT_ID=k123...
#   TS_OAUTH_CLIENT_SECRET=tskey-client-...
# Create with:  encrypt ts-oauth.env   then move the .age here.
: "${TS_ACL_CREDS:=$KEYS_HOME/tailscale/ts-oauth.env.age}"

# Tailnet to query. "-" means the default tailnet of the credential.
: "${TS_TAILNET:=-}"

# Vault doc whose fenced ```json ACL block is the stored mirror, used by `diff`.
: "${TS_ACL_VAULT_DOC:=$NOTES_HOME/02 Infrastructure/Tailscale/ACL Policy.md}"
