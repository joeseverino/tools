#!/usr/bin/env bats
# drift.bats — hermetic tests for lib/drift.sh, the shared drift-guard core
# behind ts-acl / cf-dns / adguard. A fake tool injects fetch_live + normalize,
# so vault_block / diff / pull are exercised with no network, creds, or decrypt.

load helpers

setup() {
    DRIFT_DIR="$BATS_TEST_TMPDIR/drift"
    mkdir -p "$DRIFT_DIR"

    # drift_main's preflight requires curl/jq/decrypt on PATH. The fake tool
    # injects fetch_live (no network, no creds), so it never calls curl or
    # decrypt — stub them so the check passes in a hermetic env where the bin/
    # tools aren't on PATH (CI). jq is real: normalize needs it.
    STUBS="$DRIFT_DIR/stubs"
    mkdir -p "$STUBS"
    local c
    for c in curl decrypt; do
        printf '#!/usr/bin/env bash\n' > "$STUBS/$c"
        chmod +x "$STUBS/$c"
    done
    export PATH="$STUBS:$PATH"

    LIVE_JSON="$DRIFT_DIR/live.json"
    VAULT_DOC="$DRIFT_DIR/doc.md"
    TOOL="$DRIFT_DIR/faketool"

    # Canned live state — deliberately unsorted so normalize has to order it.
    cat > "$LIVE_JSON" <<'JSON'
[
  {"id":"b","val":2},
  {"id":"a","val":1}
]
JSON

    # A fake drift tool: the real lib/drift.sh with injected hooks. fetch_live
    # reads the canned file (the only thing a real tool does differently).
    cat > "$TOOL" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$TOOLS_HOME/lib/common.sh"
source "$TOOLS_HOME/lib/drift.sh"
DRIFT_VAULT_DOC="\${DRIFT_VAULT_DOC:-$VAULT_DOC}"
DRIFT_VAULT_HEADING="## Mirror"
usage() { echo "usage text"; }
normalize() { jq -S 'sort_by(.id)'; }
fetch_live() { normalize < "$LIVE_JSON"; }
drift_main "\$@"
EOF
    chmod +x "$TOOL"
}

# write_doc <block> — vault doc with surrounding frontmatter + prose and the
# given JSON between the mirror fences.
write_doc() {
    cat > "$VAULT_DOC" <<EOF
---
doc_id: test
---

## Intro

prose stays.

## Mirror

note line.

\`\`\`json
$1
\`\`\`

## After

tail prose.
EOF
}

normalized_live() { jq -S 'sort_by(.id)' < "$LIVE_JSON"; }

@test "diff: in sync when the stored block matches live" {
    write_doc "$(normalized_live)"
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "diff: drift (exit 1) when the block differs from live" {
    write_doc '[]'
    run "$TOOL" diff
    [ "$status" -eq 1 ]
    [[ "$output" == *"drift"* ]]
}

@test "diff: ordering in the stored block never causes false drift" {
    # Same records as live, but written in the opposite order — normalize on
    # both sides must canonicalize them to equal.
    write_doc '[{"id":"b","val":2},{"id":"a","val":1}]'
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "pull: seeds an empty placeholder, then diff is in sync (round trip)" {
    write_doc '[]'
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"pulled"* ]]
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "pull: replaces an existing block, preserving surrounding prose" {
    write_doc '[{"id":"stale","val":9}]'
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    grep -q "prose stays." "$VAULT_DOC"
    grep -q "^## After"    "$VAULT_DOC"
    grep -q "tail prose."  "$VAULT_DOC"
    grep -q '"id": "a"'    "$VAULT_DOC"
    ! grep -q "stale"      "$VAULT_DOC"
}

@test "pull: appends the section when the heading is absent" {
    cat > "$VAULT_DOC" <<'EOF'
---
doc_id: test
---

## Intro

no mirror heading here yet.
EOF
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    grep -q "^## Mirror" "$VAULT_DOC"
    run "$TOOL" diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync"* ]]
}

@test "pull: stamps last_reviewed via the vault-mcp touch-reviewed CLI" {
    # Stub the MCP binary; record argv so we can assert the subcommand and the
    # vault-relative path drift.sh hands it.
    local stub="$DRIFT_DIR/severino-vault-mcp"
    cat > "$stub" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$DRIFT_DIR/mcp.args"
echo '{"ok":true}'
EOF
    chmod +x "$stub"
    export DRIFT_REVIEW_BIN="$stub"
    # The doc must live under NOTES_HOME for the relative-path math to fire.
    export NOTES_HOME="$DRIFT_DIR/vault"
    export DRIFT_VAULT_DOC="$NOTES_HOME/sub/doc.md"
    mkdir -p "$NOTES_HOME/sub"
    cat > "$DRIFT_VAULT_DOC" <<'EOF'
---
doc_id: test
---

## Mirror

```json
[]
```
EOF
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"reviewed"* ]]
    run cat "$DRIFT_DIR/mcp.args"
    [ "$output" = "touch-reviewed sub/doc.md" ]
}

@test "pull: review stamp is skipped cleanly when the MCP binary is absent" {
    export DRIFT_REVIEW_BIN="$DRIFT_DIR/no-such-mcp"
    write_doc '[]'
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"pulled"* ]]
    [[ "$output" != *"reviewed"* ]]
}

@test "pull: clean teardown — no set -u unbound-variable error" {
    # Regression guard: the EXIT-trap-on-locals bug printed
    # "jsonf: unbound variable" after a successful pull.
    write_doc '[]'
    run "$TOOL" pull
    [ "$status" -eq 0 ]
    [[ "$output" != *"unbound variable"* ]]
}
