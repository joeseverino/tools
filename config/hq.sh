# shellcheck shell=bash
# config/hq.sh — Severino HQ sync tool configuration
#
# Sourced by `hq`. Each variable can be overridden per-invocation.

: "${NOTES_HOME:?set in ~/.zshrc}"

# Vault root we walk for frontmatter.
: "${VAULT:=$NOTES_HOME}"

# Local checkout of the HQ app. Used by `hq ship` to commit/push/deploy a
# code correction from one command.
: "${CODE_HOME:=$HOME/Documents/Code}"
: "${HQ_LOCAL_PATH:=$CODE_HOME/Projects/severino-hq}"

# Folders under $VAULT we recurse into for doc indexing. Anything outside is
# ignored — we don't want to vacuum personal notes into HQ.
: "${HQ_VAULT_DIRS:=01 Projects:02 Infrastructure:03 Runbooks:05 Writeups:06 Pages}"

# SSH alias of the server where Severino HQ runs. Set in your ~/.zshrc to
# match the entry in your ~/.ssh/config — e.g. `export HQ_SSH_HOST=hq-host`.
: "${HQ_SSH_HOST:?set in ~/.zshrc — SSH alias for the HQ server}"

# Project path on $HQ_SSH_HOST where the Django app is checked out.
# e.g. `export HQ_REMOTE_PATH=/opt/apps/severino-hq`.
: "${HQ_REMOTE_PATH:?set in ~/.zshrc — install path on \$HQ_SSH_HOST}"

# URL where HQ is served (used for the open-in-browser helper).
# e.g. `export HQ_URL=https://hq.example.com`.
: "${HQ_URL:?set in ~/.zshrc — URL where HQ is served}"
