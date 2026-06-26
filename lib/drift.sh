# shellcheck shell=bash
# shellcheck disable=SC2154  # colors, and the fetch_live/normalize/usage hooks come from the sourcing tool
# drift.sh — shared core for the drift-guard tools (ts-acl, cf-dns, adguard, nginx).
#
# A drift guard compares live API state against a JSON cache owned by the
# infra-dataset registry. Each tool provides:
#
#   fetch_live   — echo the live state as normalized JSON (pipes through normalize)
#   normalize    — stdin → canonical, sorted JSON; MUST be idempotent on its own
#                  output (diff/pull re-run it over the cached value)
#   usage        — the tool's -h text
#
# and sets, after sourcing its config:
#
#   DRIFT_DATASET_ID  — the infra-dataset id whose cache this guard owns
#
# then ends with:  drift_main "$@"
#
# Sourced after lib/init.sh, so die/msg/colors are already available.
#
# All vault I/O goes through the vault MCP, which owns storage + rendering:
# `diff` reads the cache via `severino-vault-mcp infra <id>`; `pull` writes it —
# the JSON cache, the doc's generated table, and the last_reviewed stamp in one
# call — via `infra-write <id>`. The guard only fetches the live system and
# normalizes; it never touches vault files directly.

DRIFT_DATASET_ID="${DRIFT_DATASET_ID:-}"

# The vault-mcp console script backs both the cache read (`infra`) and the pull
# write (`infra-write`). Overridable via $DRIFT_REVIEW_BIN so the bats suite can
# stub it.
DRIFT_REVIEW_BIN="${DRIFT_REVIEW_BIN:-severino-vault-mcp}"

# drift_read_creds <creds-file> — decrypt an age creds env and echo its KEY=val
# lines for a guard's get_token/get_creds to parse. The ONE place guards read
# credentials: each declares only its file + the keys it pulls, never re-copying
# the file-check and the decrypt. Errors go to STDERR and return non-zero (not
# the captured-and-lost stdout the inline `done < <(decrypt …) || die` produced —
# that die was dead anyway, since a while-loop's exit status is its body's, not
# the process substitution's). Callers capture and gate:
#   creds=$(drift_read_creds "$X_CREDS") || return 1
drift_read_creds() {
    local file="$1" out
    if [[ ! -f "$file" ]]; then
        msg "$RED" "error" "creds not found: $file (see -h)" >&2
        return 1
    fi
    if ! out=$(decrypt -p "$file" 2>/dev/null); then
        msg "$RED" "error" "could not decrypt $file (try: tools key test)" >&2
        return 1
    fi
    printf '%s\n' "$out"
}

# Read the registry's cached value for this dataset and re-normalize it, so it
# compares byte-for-byte against fetch_live.
drift_registry_cached() {
    local out
    out=$(SVMC_VAULT_PATH="$NOTES_HOME" "$DRIFT_REVIEW_BIN" infra "$DRIFT_DATASET_ID" 2>/dev/null) \
        || die "error" "vault-mcp infra $DRIFT_DATASET_ID failed (is the MCP installed?)" >&2
    jq -e '.ok == true and (.data != null)' <<<"$out" >/dev/null 2>&1 \
        || die "error" "no cache for $DRIFT_DATASET_ID: $(jq -r '.error // "withheld/empty"' <<<"$out")" >&2
    jq '.data' <<<"$out" | normalize
}

# Write live state through the MCP: the JSON cache + the doc table + the
# last_reviewed stamp, one canonical write.
drift_registry_pull() {
    local live="$1" out
    out=$(printf '%s\n' "$live" \
        | SVMC_VAULT_PATH="$NOTES_HOME" "$DRIFT_REVIEW_BIN" infra-write "$DRIFT_DATASET_ID") \
        || die "error" "vault-mcp infra-write $DRIFT_DATASET_ID failed: ${out:-no output}"
    msg "$DIM" "wrote" "$(jq -r '.wrote // "cache"' <<<"$out") ($(jq -r '.records // "?"' <<<"$out") records)"
    local docu; docu=$(jq -r '.doc_updated // ""' <<<"$out")
    [[ -n $docu ]] && msg "$DIM" "doc" "regenerated table → $docu"
    msg "$DIM" "reviewed" "last_reviewed → $(jq -r '.reviewed // "today"' <<<"$out") (vault-mcp)"
}

# Diff live vs the vault cache. Exit 1 on drift.
drift_diff() {
    local live vault diff_out
    live=$(fetch_live)
    vault=$(drift_registry_cached) || exit 1
    if diff_out=$(diff <(echo "$vault") <(echo "$live")); then
        msg "$GREEN" "in sync" "live matches the vault cache"
        echo
    else
        msg "$YELLOW" "drift" "live differs from the vault cache (< cache, > live)"
        echo
        echo "$diff_out"
        echo
        exit 1
    fi
}

# Regenerate the cache (JSON file + doc table) from live.
drift_pull() {
    local live
    live=$(fetch_live)
    drift_registry_pull "$live"

    local n; n=$(jq 'length' <<<"$live" 2>/dev/null || echo "?")
    echo
    msg "$GREEN" "pulled" "$n records → $DRIFT_DATASET_ID"
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
    # live API (network), pull writes the vault cache via the MCP (vault_write).
    desc_effect read
    desc_cmd show -- "Fetch and print the live state (normalized, sorted JSON)"
    desc_effect read +network
    desc_cmd diff -- "Diff live vs the vault cache; exit 1 on drift"
    desc_effect read +network
    desc_cmd pull -- "Regenerate the vault cache (JSON + doc table) from live (accept drift)"
    desc_effect vault_write +network
}

# Require the shared deps, then dispatch. Tools call this last with "$@".
drift_main() {
    # All help + the machine surface (main, --describe, and focused `<cmd> -h`)
    # render from the one spec via the shared intercept, before the network-dep
    # gate — so help works without curl/jq/decrypt and a help flag never runs a
    # network action (e.g. `pull -h`).
    desc_help_intercept "$@"
    [[ -n $DRIFT_DATASET_ID ]] \
        || die "error" "DRIFT_DATASET_ID is not set (guard misconfigured)"
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
