# shellcheck shell=bash
# Read-only vault working-tree facts for status surfaces.

# vault_tree <vault-path> — "clean" or "<n> uncommitted".
vault_tree() {
    local n
    n=$(git -C "$1" status --porcelain | wc -l | tr -d ' ')
    if (( n > 0 )); then echo "$n uncommitted"; else echo "clean"; fi
}

# vault_remote_local <vault-path> — "in sync" or "<ahead>↑ <behind>↓" against
# the already-fetched upstream; vault_remote fetches first.
vault_remote_local() {
    local ahead behind
    ahead=$(git -C "$1" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
    behind=$(git -C "$1" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)
    if (( ahead > 0 || behind > 0 )); then echo "${ahead}↑ ${behind}↓"; else echo "in sync"; fi
}

vault_remote() {
    git -C "$1" fetch --quiet 2>/dev/null || true
    vault_remote_local "$1"
}

# inbox_count <inbox-path> — number of top-level *.md files (0 if missing).
inbox_count() {
    [[ -d "$1" ]] || { echo 0; return; }
    find "$1" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' '
}
