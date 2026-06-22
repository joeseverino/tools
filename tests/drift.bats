#!/usr/bin/env bats
# drift.bats — hermetic tests for lib/drift.sh, the shared drift-guard core
# behind ts-acl / cf-dns / adguard / nginx. A fake tool injects fetch_live +
# normalize and points DRIFT_REVIEW_BIN at a stub MCP that maintains the JSON
# cache, so show / diff / pull are exercised with no network, creds, or vault.

load helpers

setup() {
    DRIFT_DIR="$BATS_TEST_TMPDIR/drift"
    mkdir -p "$DRIFT_DIR"

    # drift_main's preflight requires curl/jq/decrypt on PATH. The fake tool
    # injects fetch_live (no network, no creds), so it never calls curl or
    # decrypt — stub them. jq is real: normalize and the stub MCP need it.
    STUBS="$DRIFT_DIR/stubs"
    mkdir -p "$STUBS"
    local c
    for c in curl decrypt; do
        printf '#!/usr/bin/env bash\n' > "$STUBS/$c"
        chmod +x "$STUBS/$c"
    done
    export PATH="$STUBS:$PATH"

    LIVE_JSON="$DRIFT_DIR/live.json"
    CACHE="$DRIFT_DIR/cache.json"        # the stub MCP's backing store
    TOOL="$DRIFT_DIR/faketool"
    export CACHE
    export NOTES_HOME="$DRIFT_DIR/vault"; mkdir -p "$NOTES_HOME"

    # Canned live state — deliberately unsorted so normalize has to order it.
    cat > "$LIVE_JSON" <<'JSON'
[
  {"id":"b","val":2},
  {"id":"a","val":1}
]
JSON

    # Stub MCP: `infra <id>` returns {ok,data} from $CACHE; `infra-write <id>`
    # stores stdin into $CACHE and reports records — the new-model read/write.
    local mcp="$DRIFT_DIR/severino-vault-mcp"
    cat > "$mcp" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  infra)
    if [[ -f "$CACHE" ]]; then printf '{"ok":true,"data":%s}\n' "$(cat "$CACHE")"
    else printf '{"ok":false,"error":"no cache"}\n'; fi ;;
  infra-write)
    cat > "$CACHE"
    printf '{"ok":true,"wrote":"%s.json","records":%s,"reviewed":"today"}\n' \
        "$2" "$(jq 'length' < "$CACHE" 2>/dev/null || echo 0)" ;;
esac
EOF
    chmod +x "$mcp"
    export DRIFT_REVIEW_BIN="$mcp"

    # A fake drift tool: the real lib/drift.sh with injected hooks.
    cat > "$TOOL" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$TOOLS_HOME/lib/common.sh"
source "$TOOLS_HOME/lib/describe.sh"
source "$TOOLS_HOME/lib/drift.sh"
DRIFT_DATASET_ID="\${FAKE_DATASET_ID-test_ds}"
usage() { echo "usage text"; }
normalize() { jq -S 'sort_by(.id)'; }
fetch_live() { normalize < "$LIVE_JSON"; }
drift_main "\$@"
EOF
    chmod +x "$TOOL"
}

seed_cache() { jq -S 'sort_by(.id)' <<<"$1" > "$CACHE"; }
normalized_live() { jq -S 'sort_by(.id)' < "$LIVE_JSON"; }

@test "diff: in sync when the cache matches live" {
    seed_cache "$(cat "$LIVE_JSON")"
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "diff: drift (exit 1) when the cache differs from live" {
    seed_cache '[]'
    run "$TOOL" diff
    [ "$status" -eq 1 ]
    [[ "$output" == *"drift"* ]]
}

@test "diff: ordering in the cache never causes false drift" {
    seed_cache '[{"id":"a","val":1},{"id":"b","val":2}]'
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "pull: writes the cache, then diff is in sync (round trip)" {
    rm -f "$CACHE"
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"pulled"* ]]
    [[ "$output" == *"reviewed"* ]]
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "pull: routes the write through the vault-mcp infra-write CLI" {
    rm -f "$CACHE"
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    # The stub stored the normalized live payload as the cache.
    run diff <(jq -S 'sort_by(.id)' < "$CACHE") <(normalized_live)
    [ "$status" -eq 0 ]
}

@test "diff: clear error when the dataset has no cache" {
    rm -f "$CACHE"
    run "$TOOL" diff
    [ "$status" -ne 0 ]
    [[ "$output" == *"no cache"* ]]
}

@test "guard: missing DRIFT_DATASET_ID is a configuration error" {
    seed_cache '[]'
    FAKE_DATASET_ID="" run "$TOOL" diff
    [ "$status" -ne 0 ]
    [[ "$output" == *"DRIFT_DATASET_ID"* ]]
}

@test "pull: clean teardown — no set -u unbound-variable error" {
    rm -f "$CACHE"
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    [[ "$output" != *"unbound variable"* ]]
}
