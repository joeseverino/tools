# shellcheck shell=bash
# shellcheck disable=SC2034  # color vars are read by tools that source this file
# common.sh — shared helpers for the personal CLI tools.
# Sourced, not executed.

# ANSI styling — only emitted when stdout is a terminal.
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
    GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'
else
    BOLD=''; DIM=''; RESET=''; GREEN=''; RED=''; YELLOW=''
fi

# msg <color> <label> <body>
# Print one status line: colored bold label in a fixed-width column,
# then plain body. Used by every tool's per-item output.
msg() {
    printf '  %s%-10s%s %s\n' "$1$BOLD" "$2" "$RESET" "$3"
}

# die <label> <body> [<exit-code>]   — the repo convention.
# A single-argument call (die "<message>") is also supported: the message
# becomes the body under a default "error" label. Without this, a lone-arg
# call expands an unset $2 and crashes under `set -u` (bin/hq uses this form
# throughout); 2-arg is always (label, body), never (body, code).
die() {
    local label body code
    if (( $# >= 2 )); then
        label="$1"; body="$2"; code="${3:-1}"
    else
        label="error"; body="${1:-}"; code=1
    fi
    echo
    msg "$RED" "$label" "$body"
    echo
    exit "$code"
}

# die_unknown <kind> <token> [<subcommand>] — the uniform usage error for an
# unrecognized flag / command / value. Instead of a dead-end "try -h" pointer it
# SHOWS the valid surface, rendered from the one describe_spec: the command list
# for a bad command, or that command's own options/args for a bad flag. So the
# fix is on screen, nothing is hand-written, and it can't drift. Exits 2.
#
#   die_unknown command "$1"          -> error + the tool's command list
#   die_unknown flag "$1" sync        -> error + `sync`'s options/args
#   die_unknown "test mode" "$1" test -> error + `test`'s options
die_unknown() {
    local kind="$1" token="$2" sub="${3:-}"
    echo
    msg "$RED" "usage" "unknown $kind: $token"
    if [[ -n "$sub" ]]; then usage_command "$sub"; else usage; fi
    exit 2
}

# header <verb> <count>
header() {
    local s=""
    (( $2 == 1 )) || s="s"
    echo
    printf '  %s%s%s %d file%s\n' "$BOLD" "$1" "$RESET" "$2" "$s"
    echo
}

# footer <verb> <ok> <skipped> <failed>
footer() {
    if (( $2 + $3 + $4 > 1 )); then
        echo
        printf '  %ssummary%s    %d %s, %d skipped, %d failed\n' \
            "$BOLD" "$RESET" "$2" "$1" "$3" "$4"
    fi
    echo
}

# shebang_has <word> <file> — true if the file's first line mentions <word>.
# Routes files to the right checker (bash/zsh/node) by shebang.
shebang_has() {
    head -1 "$2" 2>/dev/null | grep -q "$1"
}

# require_files <label> <path>... — die unless every path is a regular file.
require_files() {
    local label="$1" f; shift
    for f in "$@"; do
        [[ -f "$f" ]] || die "error" "$label not found: $f"
    done
}

# json_escape <string> — escape a string for use inside a JSON value.
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# json_bool <0|1> — print a JSON boolean.
json_bool() {
    if (( $1 )); then printf 'true'; else printf 'false'; fi
}

# json_join <item>... — comma-join pre-rendered JSON fragments.
json_join() {
    local IFS=','
    printf '%s' "$*"
}

# svmc <subcommand> [args] — the ONE call into the severino-vault-mcp brain (the
# vault's schema-validated, atomic reader/writer). Every tool that reads or
# writes the vault routes through this — no inline `severino-vault-mcp` call site
# — so two things can never be forgotten: the vault is pinned to $NOTES_HOME
# (not the MCP's own configured default, whose silent fallback reads the wrong
# vault), and the binary is named in one place via $SVMC_BIN (tests stub it),
# mirroring the drift guards' $DRIFT_REVIEW_BIN seam.
svmc() {
    SVMC_VAULT_PATH="${NOTES_HOME:-}" "${SVMC_BIN:-severino-vault-mcp}" "$@"
}

# Trim age's noisy error to a single useful line.
age_reason() {
    echo "$1" | head -1 | sed 's/^age: error: //'
}

# vault_tree <vault-path> — "clean" or "<n> uncommitted".
vault_tree() {
    local n
    n=$(git -C "$1" status --porcelain | wc -l | tr -d ' ')
    if (( n > 0 )); then
        echo "$n uncommitted"
    else
        echo "clean"
    fi
}

# vault_remote <vault-path> — "in sync" or "<ahead>↑ <behind>↓".
vault_remote() {
    git -C "$1" fetch --quiet 2>/dev/null || true
    local ahead behind
    ahead=$(git -C "$1" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
    behind=$(git -C "$1" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)
    if (( ahead > 0 || behind > 0 )); then
        echo "${ahead}↑ ${behind}↓"
    else
        echo "in sync"
    fi
}

# inbox_count <inbox-path> — number of top-level *.md files (0 if missing).
inbox_count() {
    [[ -d "$1" ]] || { echo 0; return; }
    find "$1" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' '
}

# ---------------------------------------------------------------------------
# CI parity — ONE definition of the hermetic, CI-equivalent shell environment,
# derived by both the bats harness (tests/helpers.bash) and `tools check --ci`
# (emit once, derive everywhere). Every local↔CI divergence that has bitten is
# neutralized here, once: a stale ~/.local/bin tool shadowing repo code on
# $PATH, and the operator's global/system git config (init.defaultBranch, host
# aliases, hooks) leaking into git operations.
# ---------------------------------------------------------------------------

# path_without <dir> [<path>] — echo <path> (default $PATH) with every segment
# equal to <dir> removed (empty segments dropped). Pure; no side effects.
path_without() {
    local drop="$1" src="${2-$PATH}" out="" seg
    local IFS=':'
    for seg in $src; do
        [[ -z "$seg" || "$seg" == "$drop" ]] && continue
        out+="${out:+:}$seg"
    done
    printf '%s' "$out"
}

# ci_shell_env — apply the CI-equivalent environment to the current shell so a
# local run exercises exactly what CI does. Reads $TOOLS_HOME; the install dir
# from $TOOLS_INSTALL_DIR (default ~/.local/bin).
#   PATH: this checkout's bin first, the install dir removed — a stale installed
#         symlink can never shadow repo code (CI has no install dir). Idempotent:
#         safe to call from a parent and again in a child it spawns.
#   git:  empty global + system config so init.defaultBranch, host aliases, and
#         hooks from the operator's machine don't leak (CI runs a clean config).
ci_shell_env() {
    : "${TOOLS_HOME:?ci_shell_env needs TOOLS_HOME}"
    local bin="${TOOLS_HOME%/}/bin" install="${TOOLS_INSTALL_DIR:-$HOME/.local/bin}"
    local rest
    rest="$(path_without "$install" "$(path_without "$bin")")"
    export PATH="$bin:$rest"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1
}

# hq_sync_state_file — where `hq sync` records what it shipped (manifest
# hash + inputs), so `vault status` and `hq doctor` can detect staleness
# exactly instead of relying on the "remember to run hq sync" convention.
hq_sync_state_file() {
    printf '%s/severino-tools/hq-sync.json' "${XDG_STATE_HOME:-$HOME/.local/state}"
}

# hq_sync_freshness <vault-path> — compare the vault's current HQ manifest
# hash against the one recorded by the last successful `hq sync`. Prints:
#
#   never            no sync recorded yet
#   skip             check can't run here (no MCP CLI, or state from another vault)
#   fresh <date>     HQ matches the manifest the vault produces right now
#   stale <date>     doc metadata changed since the last sync
#
# Exact by construction: the hash covers precisely the frontmatter manifest
# HQ imports (dirs read back from the state file), so prose-only edits and
# unrelated commits never flag. ~0.2s on the real vault.
hq_sync_freshness() {
    local vault_path="$1" state sha dirs synced state_vault current
    state="$(hq_sync_state_file)"
    [[ -f "$state" ]] || { echo "never"; return 0; }
    command -v severino-vault-mcp >/dev/null 2>&1 || { echo "skip"; return 0; }
    IFS=$'\t' read -r sha dirs synced state_vault < <(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
print(s.get("manifest_sha256", ""), s.get("vault_dirs", ""),
      s.get("synced_at", ""), s.get("vault", ""), sep="\t")
' "$state" 2>/dev/null) || { echo "skip"; return 0; }
    [[ -n "$sha" && -n "$dirs" && "$state_vault" == "$vault_path" ]] \
        || { echo "skip"; return 0; }
    local manifest
    manifest="$(severino-vault-mcp hq-manifest "$vault_path" "$dirs" 2>/dev/null)" \
        || { echo "skip"; return 0; }
    [[ -n "$manifest" ]] || { echo "skip"; return 0; }
    current="$(printf '%s\n' "$manifest" | shasum -a 256 | cut -d' ' -f1)"
    if [[ "$current" == "$sha" ]]; then
        echo "fresh ${synced%%T*}"
    else
        echo "stale ${synced%%T*}"
    fi
}
