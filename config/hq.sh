# config/hq.sh — Severino HQ sync tool configuration
#
# Sourced by `hq`. Each variable can be overridden per-invocation.

: "${NOTES_HOME:?set in ~/.zshrc}"

# Vault root we walk for frontmatter.
: "${VAULT:=$NOTES_HOME}"

# Folders under $VAULT we recurse into for doc indexing. Anything outside is
# ignored — we don't want to vacuum personal notes into HQ.
: "${HQ_VAULT_DIRS:=01 Projects:02 Infrastructure:03 Runbooks}"

# SSH alias of the homelab server where Severino HQ runs.
: "${HQ_SSH_HOST:=homelab-server}"

# Project path on the homelab where Severino HQ is checked out.
: "${HQ_REMOTE_PATH:=/opt/apps/severino-hq}"

# Public URL of the running HQ (used for the open-in-browser helper).
: "${HQ_URL:=https://hq.jseverino.com}"
