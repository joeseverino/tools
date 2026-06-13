# shellcheck shell=bash
# shellcheck disable=SC2154  # DRIFT_*, colors, and the fetch_live/normalize/usage hooks come from the sourcing tool
# drift.sh — shared core for the drift-guard tools (ts-acl, cf-dns, adguard, ...).
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
# Sourced after lib/init.sh, so die/msg/colors are already available.
#
# All block parsing is scoped to the DRIFT_VAULT_HEADING *section* (it ends at
# the next heading outside a code fence), so two mirrors in one doc can never
# be confused. `pull` prefers the vault MCP's `update-mirror-block` — the
# canonical, atomic writer that also stamps last_reviewed in the same write —
# and falls back to an awk rewrite with the same scoping when the MCP CLI
# isn't installed or the doc lives outside $NOTES_HOME.

# Extract the fenced ```json block under DRIFT_VAULT_HEADING and re-normalize it,
# so it compares byte-for-byte against fetch_live regardless of stored ordering.
# Scoped to the heading's own section; fenced blocks of other languages are
# skipped rather than mistaken for headings or the mirror.
drift_vault_block() {
    [[ -f $DRIFT_VAULT_DOC ]] || die "error" "vault doc not found: $DRIFT_VAULT_DOC"
    local block
    block=$(awk -v heading="$DRIFT_VAULT_HEADING" '
        !insec {
            if (!fence && $0 == heading) insec = 1
            else if (/^```/) fence = !fence
            next
        }
        capture { if (/^```/) exit; print; next }
        fence   { if (/^```/) fence = 0; next }
        /^```json/ { capture = 1; next }
        /^```/     { fence = 1; next }
        /^#/       { exit }
    ' "$DRIFT_VAULT_DOC")
    # An empty extraction means the section has no block: piping it through
    # jq would "succeed" and report misleading whole-mirror drift instead.
    # Errors go to stderr — callers run this inside $( ), which would
    # otherwise swallow the message along with the block.
    [[ -n $block ]] \
        || die "error" "no ${DRIFT_VAULT_HEADING} \`\`\`json block in $DRIFT_VAULT_DOC (run: pull)" >&2
    printf '%s\n' "$block" | normalize \
        || die "error" "invalid ${DRIFT_VAULT_HEADING} \`\`\`json block in $DRIFT_VAULT_DOC (run: pull)" >&2
}

# Diff live vs the vault mirror. Exit 1 on drift.
drift_diff() {
    local live vault diff_out
    live=$(fetch_live)
    vault=$(drift_vault_block) || exit 1
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

# The vault-mcp console script backs both the canonical pull write
# (update-mirror-block) and the fallback's review stamp (touch-reviewed).
# Overridable via $DRIFT_REVIEW_BIN so the bats suite can stub it.
DRIFT_REVIEW_BIN="${DRIFT_REVIEW_BIN:-severino-vault-mcp}"

# Stamp `last_reviewed: <today>` through the MCP's `touch-reviewed` — only
# used on the fallback path; the MCP pull stamps it in the same write.
# Best-effort: skips silently if the MCP CLI isn't on PATH or the doc isn't
# under $NOTES_HOME (the MCP only writes inside the indexed vault).
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

# Canonical pull write: hand the normalized JSON to the MCP, which replaces
# the section's block and stamps last_reviewed in one atomic write. Returns 1
# (caller falls back) only when the MCP path isn't *available* — binary
# missing, subcommand missing (stale install), or doc outside $NOTES_HOME.
# An actual write failure dies: the MCP refusing a path or payload is a real
# error, not a reason to write the file raw.
drift_mcp_pull() {
    local live="$1" rel out
    command -v "$DRIFT_REVIEW_BIN" >/dev/null 2>&1 || return 1
    [[ -n ${NOTES_HOME:-} && $DRIFT_VAULT_DOC == "$NOTES_HOME"/* ]] || return 1
    "$DRIFT_REVIEW_BIN" update-mirror-block --help >/dev/null 2>&1 || return 1
    rel="${DRIFT_VAULT_DOC#"$NOTES_HOME"/}"
    if ! out=$(printf '%s\n' "$live" \
            | SVMC_VAULT_PATH="$NOTES_HOME" "$DRIFT_REVIEW_BIN" update-mirror-block \
                "$rel" --heading "$DRIFT_VAULT_HEADING" --touch-reviewed); then
        die "error" "vault-mcp update-mirror-block failed: ${out:-no output}"
    fi
    msg "$DIM" "reviewed" "last_reviewed → today (vault-mcp)"
}

# Fallback pull write (no MCP): same section scoping as drift_vault_block.
# Replaces the block when the section has one, inserts at the section's end
# when the heading exists without a block, appends a fresh section otherwise.
# Staged in the doc's own directory so the final mv is an atomic same-fs rename.
drift_awk_pull() {
    local live="$1" jsonf outf mode
    jsonf=$(mktemp)
    printf '%s\n' "$live" > "$jsonf"
    outf=$(mktemp "$(dirname "$DRIFT_VAULT_DOC")/.drift-pull.XXXXXX")

    mode=$(awk -v heading="$DRIFT_VAULT_HEADING" '
        BEGIN { mode = "append" }
        END   { print mode }
        !insec {
            if (!fence && $0 == heading) { insec = 1; mode = "insert" }
            else if (/^```/) fence = !fence
            next
        }
        fence      { if (/^```/) fence = 0; next }
        /^```json/ { mode = "replace"; exit }
        /^```/     { fence = 1; next }
        /^#/       { exit }
    ' "$DRIFT_VAULT_DOC")

    case "$mode" in
        replace)
            awk -v heading="$DRIFT_VAULT_HEADING" -v jsonfile="$jsonf" '
                BEGIN { while ((getline l < jsonfile) > 0) payload = payload l "\n" }
                done { print; next }
                !insec {
                    if (!fence && $0 == heading) insec = 1
                    else if (/^```/) fence = !fence
                    print; next
                }
                drop  { if (/^```/) { print; done = 1 }; next }
                fence { print; if (/^```/) fence = 0; next }
                /^```json/ { printf "```json\n%s", payload; drop = 1; next }
                /^```/     { fence = 1; print; next }
                { print }
            ' "$DRIFT_VAULT_DOC" > "$outf"
            ;;
        insert)
            awk -v heading="$DRIFT_VAULT_HEADING" -v jsonfile="$jsonf" '
                BEGIN { while ((getline l < jsonfile) > 0) payload = payload l "\n" }
                END   { if (insec && !done) printf "\n```json\n%s```\n", payload }
                done { print; next }
                !insec {
                    if (!fence && $0 == heading) insec = 1
                    else if (/^```/) fence = !fence
                    print; next
                }
                fence { print; if (/^```/) fence = 0; next }
                /^```/ { fence = 1; print; next }
                /^#/   { printf "```json\n%s```\n\n", payload; done = 1; print; next }
                { print }
            ' "$DRIFT_VAULT_DOC" > "$outf"
            ;;
        append)
            cat "$DRIFT_VAULT_DOC" > "$outf"
            {
                printf '\n%s\n\n```json\n' "$DRIFT_VAULT_HEADING"
                cat "$jsonf"
                printf '```\n'
            } >> "$outf"
            ;;
    esac

    mv "$outf" "$DRIFT_VAULT_DOC"
    rm -f "$jsonf"
}

# Regenerate the mirror block from live.
drift_pull() {
    [[ -f $DRIFT_VAULT_DOC ]] || die "error" "vault doc not found: $DRIFT_VAULT_DOC"

    local live
    live=$(fetch_live)

    if ! drift_mcp_pull "$live"; then
        drift_awk_pull "$live"
        drift_touch_reviewed "$DRIFT_VAULT_DOC"
    fi

    local n; n=$(jq 'length' <<<"$live")
    echo
    msg "$GREEN" "pulled" "$n records → $(basename "$DRIFT_VAULT_DOC")"
    msg "$DIM"   "next"   "review the diff, reconcile the prose, then: hq sync"
    echo
}

# The standard drift-guard command surface (show/diff/pull), single-sourced so
# every guard's describe_spec / -h render the same three commands. A guard's
# describe_spec calls this after its own desc_tool / desc_synopsis, then adds
# its config desc_env lines.
drift_describe_commands() {
    # Effects are declared once here and inherited by every guard (adguard,
    # cf-dns, ts-acl, nginx) — the zero-duplication payoff: show/diff read the
    # live API (network), pull rewrites the vault mirror block (vault_write).
    desc_cmd show -- "Fetch and print the live state (normalized, sorted JSON)"
    desc_effect read +network
    desc_cmd diff -- "Diff live vs the vault mirror; exit 1 on drift"
    desc_effect read +network
    desc_cmd pull -- "Regenerate the vault mirror block from live (accept drift)"
    desc_effect vault_write +network
}

# Require the shared deps, then dispatch. Tools call this last with "$@".
drift_main() {
    # All help + the machine surface (main, --describe, and focused `<cmd> -h`)
    # render from the one spec via the shared intercept, before the network-dep
    # gate — so help works without curl/jq/decrypt and a help flag never runs a
    # network action (e.g. `pull -h`).
    desc_help_intercept "$@"
    local cmd
    for cmd in curl jq decrypt; do
        command -v "$cmd" >/dev/null || die "error" "missing required command: $cmd"
    done
    case "$1" in
        show)        fetch_live ;;
        diff)        drift_diff ;;
        pull)        drift_pull ;;
        *)           die_unknown command "$1" ;;
    esac
}
