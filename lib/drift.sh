# shellcheck shell=bash
# shellcheck disable=SC2154  # DRIFT_*, colors, and the fetch_live/normalize/usage hooks come from the sourcing tool
# drift.sh — shared core for the drift-guard tools (cf-dns, adguard, ...).
#
# A drift guard compares live API state against a fenced ```json mirror in a
# vault doc. This file owns the invariant machinery; each tool provides:
#
#   fetch_live   — echo the live state as normalized JSON (pipes through normalize)
#   normalize    — stdin → canonical, sorted JSON; MUST be idempotent on its own
#                  output (diff/pull re-run it over the stored block)
#   usage        — the tool's -h text
#
# and sets, after sourcing its config:
#
#   DRIFT_VAULT_DOC      — path to the vault doc holding the mirror
#   DRIFT_VAULT_HEADING  — heading whose fenced ```json block is the mirror
#
# then ends with:  drift_main "$@"
#
# Sourced after lib/init.sh, so die/msg/colors are already available. ts-acl
# predates this and stays standalone (zsh); cf-dns/adguard/... share this file.

# Extract the fenced ```json block under DRIFT_VAULT_HEADING and re-normalize it,
# so it compares byte-for-byte against fetch_live regardless of stored ordering.
drift_vault_block() {
    [[ -f $DRIFT_VAULT_DOC ]] || die "error" "vault doc not found: $DRIFT_VAULT_DOC"
    awk -v heading="$DRIFT_VAULT_HEADING" '
        $0 == heading { in_section = 1 }
        in_section && /^```json/ { capture = 1; next }
        capture && /^```/ { exit }
        capture { print }
    ' "$DRIFT_VAULT_DOC" \
        | normalize \
        || die "error" "no ${DRIFT_VAULT_HEADING} \`\`\`json block in $DRIFT_VAULT_DOC (run: pull)"
}

# Diff live vs the vault mirror. Exit 1 on drift.
drift_diff() {
    local live vault diff_out
    live=$(fetch_live)
    vault=$(drift_vault_block)
    if diff_out=$(diff <(echo "$vault") <(echo "$live")); then
        msg "$GREEN" "in sync" "live matches the vault mirror"
        echo
    else
        msg "$YELLOW" "drift" "live differs from the vault mirror (< vault, > live)"
        echo
        echo "$diff_out"
        echo
        exit 1
    fi
}

# Stamp `last_reviewed: <today>` in the doc's frontmatter — through the vault
# MCP, the canonical frontmatter writer (schema-validated, reloads the vault
# cache), not a raw YAML edit. A pull is a review, so the date should move.
#
# Best-effort: skips silently if the MCP CLI isn't on PATH or the doc isn't
# under $NOTES_HOME (the MCP only writes inside the indexed vault). $NOTES_HOME
# is the vault root; the MCP wants a vault-relative path. The binary is
# overridable via $DRIFT_REVIEW_BIN so the bats suite can stub it.
DRIFT_REVIEW_BIN="${DRIFT_REVIEW_BIN:-severino-vault-mcp}"

drift_touch_reviewed() {
    local doc="$1" rel
    command -v "$DRIFT_REVIEW_BIN" >/dev/null 2>&1 || return 0
    [[ -n ${NOTES_HOME:-} && $doc == "$NOTES_HOME"/* ]] || return 0
    rel="${doc#"$NOTES_HOME"/}"
    if SVMC_VAULT_PATH="$NOTES_HOME" "$DRIFT_REVIEW_BIN" touch-reviewed "$rel" >/dev/null 2>&1; then
        msg "$DIM" "reviewed" "last_reviewed → today (vault-mcp)"
    else
        msg "$YELLOW" "note" "could not stamp last_reviewed via vault-mcp"
    fi
}

# Regenerate the mirror block from live. Replaces the block in place; appends a
# fresh section if the heading is not present yet.
drift_pull() {
    [[ -f $DRIFT_VAULT_DOC ]] || die "error" "vault doc not found: $DRIFT_VAULT_DOC"

    local live jsonf
    live=$(fetch_live)
    jsonf=$(mktemp)
    printf '%s\n' "$live" > "$jsonf"

    if awk -v h="$DRIFT_VAULT_HEADING" '
            $0 == h { seen = 1 }
            seen && /^```json/ { found = 1; exit }
            END { exit(found ? 0 : 1) }
        ' "$DRIFT_VAULT_DOC"; then
        local outf; outf=$(mktemp)
        awk -v heading="$DRIFT_VAULT_HEADING" -v jsonfile="$jsonf" '
            $0 == heading { inhead = 1; print; next }
            inhead && /^```json/ {
                print
                while ((getline line < jsonfile) > 0) print line
                copying = 1; next
            }
            copying && /^```/ { copying = 0; inhead = 0; print; next }
            copying { next }
            { print }
        ' "$DRIFT_VAULT_DOC" > "$outf"
        mv "$outf" "$DRIFT_VAULT_DOC"
    else
        {
            printf '\n%s\n\n```json\n' "$DRIFT_VAULT_HEADING"
            cat "$jsonf"
            printf '```\n'
        } >> "$DRIFT_VAULT_DOC"
    fi

    rm -f "$jsonf"
    drift_touch_reviewed "$DRIFT_VAULT_DOC"

    local n; n=$(jq 'length' <<<"$live")
    echo
    msg "$GREEN" "pulled" "$n records → $(basename "$DRIFT_VAULT_DOC")"
    msg "$DIM"   "next"   "review the diff, reconcile the prose, then: hq sync"
    echo
}

# Require the shared deps, then dispatch. Tools call this last with "$@".
drift_main() {
    local cmd
    for cmd in curl jq decrypt; do
        command -v "$cmd" >/dev/null || die "error" "missing required command: $cmd"
    done
    case "${1:-help}" in
        show)        fetch_live ;;
        diff)        drift_diff ;;
        pull)        drift_pull ;;
        -h|help|'')  usage ;;
        *)           die "usage" "unknown command: $1 (try -h)" 2 ;;
    esac
}
