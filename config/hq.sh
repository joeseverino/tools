# shellcheck shell=bash
# shellcheck disable=SC2034  # the semantic key/setting lists are read by bin/hq
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

# The indexed-dir list is the MCP's to derive (its config's indexed_dirs plus
# the slim content dirs) — no HQ_VAULT_DIRS copy here; one list, one owner.

# Human-readable frontmatter contract doc in the vault. `hq schema` checks its
# enum lists against the canonical MCP schema so it can't silently drift.
: "${HQ_SCHEMA_DOC:=$VAULT/02 Infrastructure/Severino HQ/Frontmatter Schema.md}"

# SSH alias of the server where Severino HQ runs. Set in your ~/.zshrc to
# match the entry in your ~/.ssh/config — e.g. `export HQ_SSH_HOST=hq-host`.
: "${HQ_SSH_HOST:=}"

# Project path on $HQ_SSH_HOST where the Django app is checked out.
# e.g. `export HQ_REMOTE_PATH=/opt/apps/severino-hq`.
: "${HQ_REMOTE_PATH:=}"

# URL where HQ is served (used for the open-in-browser helper).
# e.g. `export HQ_URL=https://hq.example.com`.
: "${HQ_URL:?set in ~/.zshrc — URL where HQ is served}"

# The 1Password item prod's env renders from (see the HQ repo's
# scripts/refresh-secrets.sh). `hq env-diff`, `hq dev`, and `hq doctor --env`
# all read it; one name, one owner.
: "${HQ_ENV_ITEM:=severino-hq env}"
: "${HQ_ENV_VAULT:=Severino HQ Production}"

# ----- Local composed dev stack (`hq dev`) -------------------------------------

# Private plugin checkouts to compose with the host: <checkout>=<module:attr>.
# Each contributes <checkout>/src to PYTHONPATH. A missing checkout is skipped,
# so a machine holding only some of them still boots.
if [[ -z "${HQ_DEV_PLUGINS+x}" ]]; then
    HQ_DEV_PLUGINS=(
        "$CODE_HOME/Projects/severino-fitness=severino_fitness.plugin:plugin"
        "$CODE_HOME/Projects/severino-life-hq=severino_life_hq.plugin:plugin"
    )
fi

# The interpreter that has HQ's runtime installed. Each plugin's
# scripts/check.sh installs the host's pinned requirements.txt into its own
# venv; fitness's is the one that carries the full set.
: "${HQ_DEV_PYTHON:=$CODE_HOME/Projects/severino-fitness/.venv.nosync/bin/python}"

# dev-hq.jseverino.com resolves to this Mac, so the dev server binds every
# interface rather than loopback — a loopback bind answers the proxy with
# connection refused, not a Django error, which is slow to diagnose.
: "${HQ_DEV_BIND:=0.0.0.0:8000}"
: "${HQ_DEV_HOSTS:=dev-hq.jseverino.com,192.168.1.138,localhost,127.0.0.1}"
: "${HQ_DEV_ORIGINS:=https://dev-hq.jseverino.com}"

# Scratch database, deliberately outside the HQ checkout: the repo's own
# data/severino.sqlite3 is what a hand-run `manage.py` grabs by default, and a
# dev boot must never be one typo away from writing real records.
: "${HQ_DEV_DB:=${XDG_STATE_HOME:-$HOME/.local/state}/severino-tools/hq-dev.sqlite3}"

# Env keys that change what stored data MEANS rather than how it is served. A
# dev/prod difference here does not error — it silently reinterprets timestamps
# and reporting windows, which is how a bad import survives review. `hq dev`
# inherits every one of these from prod, and `hq doctor --env` proves it did.
# The list is also the safety boundary on reading the 1Password item: these
# names are non-secret by construction, so nothing else can be printed.
HQ_SEMANTIC_ENV=(
    DJANGO_TIME_ZONE
    SEVERINO_FISCAL_YEAR_START_MONTH
    SEVERINO_DOC_REVIEW_INTERVAL_DAYS
)

# The Django settings those keys resolve to, compared side by side by
# `hq doctor --env`. Checked as *settings*, not as raw env, so a setting that
# is currently a hardcoded default (USE_TZ) is still covered — and stays
# covered on the day it becomes environment-driven.
HQ_SEMANTIC_SETTINGS=(
    TIME_ZONE
    USE_TZ
    SEVERINO_FISCAL_YEAR_START_MONTH
    SEVERINO_DOC_REVIEW_INTERVAL_DAYS
)

# Name shapes that read as data-meaning. Used only to flag keys prod sets that
# HQ_SEMANTIC_ENV does not forward — key names, never values — so the forward
# list can be caught lagging the item instead of silently under-covering it.
: "${HQ_SEMANTIC_PATTERN:=TIME_ZONE|_TZ$|FISCAL|INTERVAL_DAYS|LANGUAGE|LOCALE|CURRENCY|ROUNDING|WEEK_START}"

# Routine data-plane operations use HQ's authenticated MCP endpoint. The URL
# and auth-helper path live together in a non-secret local client profile;
# bearer credentials are resolved only at call time by the helper.
: "${HQ_MCP_CLIENT_CONFIG:=$HOME/.config/severino-mcp/client.json}"
: "${HQ_MCP_CLIENT:=$TOOLS_HOME/lib/hq-mcp-client.py}"
