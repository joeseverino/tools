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

# die <label> <body> [<exit-code>]
die() {
    echo
    msg "$RED" "$1" "$2"
    echo
    exit "${3:-1}"
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
