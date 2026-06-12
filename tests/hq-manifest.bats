#!/usr/bin/env bats
# hq-manifest.bats — HQ delegates manifest parsing to severino-vault-mcp.

load helpers

setup() {
    export TEST_ROOT="$BATS_TEST_TMPDIR/hq-manifest"
    export TEST_BIN="$TEST_ROOT/bin"
    export NOTES_HOME="$TEST_ROOT/vault"
    export HQ_VAULT_DIRS="03 Runbooks:05 Writeups"
    export HQ_SSH_HOST="unused"
    export HQ_REMOTE_PATH="/unused"
    export HQ_LOCAL_PATH="$TEST_ROOT/hq"
    export HQ_URL="https://hq.example.test"
    export MCP_ARGS_LOG="$TEST_ROOT/mcp-args.log"
    mkdir -p "$TEST_BIN" "$NOTES_HOME" "$HQ_LOCAL_PATH"
    export PATH="$TEST_BIN:$PATH"
}

hq_bin() {
    "$TOOLS_HOME/bin/hq" "$@"
}

@test "hq manifest delegates to the MCP shared parser" {
    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "--help" ]]; then
    printf '%s\n' "commands: hq-manifest"
    exit 0
fi
printf '%s\n' "$*" > "$MCP_ARGS_LOG"
printf '%s\n' '[{"doc_id":"rb-example"}]'
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"

    run hq_bin manifest

    [ "$status" -eq 0 ]
    [ "$output" = '[{"doc_id":"rb-example"}]' ]
    [ "$(cat "$MCP_ARGS_LOG")" = "hq-manifest $NOTES_HOME $HQ_VAULT_DIRS" ]
}

@test "hq manifest fails closed when the MCP is missing or outdated" {
    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "commands: doctor list-writeups"
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"

    run hq_bin manifest

    [ "$status" -ne 0 ]
    [[ "$output" == *"severino-vault-mcp"* ]]
    [[ "$output" == *"site reinstall-mcp"* ]]
    [[ "$output" != *"usage: severino-vault-mcp"* ]]
}

# A stub MCP that emits a fixed canonical schema for `schema --json`.
_stub_schema_mcp() {
    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "schema" ]]; then
    printf '%s\n' '{"doc_types":["runbook"],"environments":["homelab","other"]}'
    exit 0
fi
exit 0
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"
    mkdir -p "$HQ_LOCAL_PATH/docs_index"
}

@test "hq schema regenerates docs_index/schema.json from the MCP" {
    _stub_schema_mcp

    run hq_bin schema

    [ "$status" -eq 0 ]
    [[ "$output" == *"wrote"* ]]
    [ "$(cat "$HQ_LOCAL_PATH/docs_index/schema.json")" = \
        '{"doc_types":["runbook"],"environments":["homelab","other"]}' ]
}

@test "hq schema --check passes when the committed copy matches the MCP" {
    _stub_schema_mcp
    printf '%s\n' '{"doc_types":["runbook"],"environments":["homelab","other"]}' \
        > "$HQ_LOCAL_PATH/docs_index/schema.json"

    run hq_bin schema --check

    [ "$status" -eq 0 ]
    [[ "$output" == *"matches the MCP"* ]]
}

@test "hq schema --check fails (exit 1) when the committed copy is stale" {
    _stub_schema_mcp
    printf '%s\n' '{"doc_types":["runbook"],"environments":["homelab"]}' \
        > "$HQ_LOCAL_PATH/docs_index/schema.json"

    run hq_bin schema --check

    [ "$status" -eq 1 ]
    [[ "$output" == *"stale"* ]]
}

@test "hq schema fails closed when the installed MCP lacks the schema command" {
    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
exit 2
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"
    mkdir -p "$HQ_LOCAL_PATH/docs_index"

    run hq_bin schema

    [ "$status" -ne 0 ]
    [[ "$output" == *"site reinstall-mcp"* ]]
}

# --- hq doctor (delegates to the MCP manifest report) ------------------------

_stub_report_mcp() {
    cat > "$TEST_BIN/severino-vault-mcp" <<SH
#!/usr/bin/env bash
if [[ "\${1:-}" == "hq-manifest" && "\$*" == *"--report"* ]]; then
    printf '%s\n' '$1'
    exit ${2:-0}
fi
exit 0
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"
}

@test "hq doctor reports missing frontmatter from the MCP report" {
    _stub_report_mcp '{"ok":true,"count":3,"missing_frontmatter":["05 Writeups/x/notes.md"],"missing_dirs":[]}' 0

    run hq_bin doctor

    [ "$status" -eq 1 ]
    [[ "$output" == *"missing or invalid frontmatter"* ]]
    [[ "$output" == *"05 Writeups/x/notes.md"* ]]
}

@test "hq doctor is clean when the MCP report has no problems" {
    _stub_report_mcp '{"ok":true,"count":144,"missing_frontmatter":[],"missing_dirs":[]}' 0

    run hq_bin doctor

    [ "$status" -eq 0 ]
    [[ "$output" == *"144 indexed docs"* ]]
}

# --- hq schema --check also guards the vault schema doc ----------------------

@test "hq schema --check flags a stale vault Frontmatter Schema doc" {
    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
case "${1:-} ${2:-}" in
    "schema --json")      printf '%s\n' '{"doc_types":["runbook"]}'; exit 0 ;;
    "schema --check-doc")
        echo "schema doc drift in $3:" >&2
        echo "  - environment: doc lists unknown ['lab']" >&2
        exit 1 ;;
esac
exit 0
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"
    mkdir -p "$HQ_LOCAL_PATH/docs_index"
    printf '%s\n' '{"doc_types":["runbook"]}' > "$HQ_LOCAL_PATH/docs_index/schema.json"
    export HQ_SCHEMA_DOC="$TEST_ROOT/schema-doc.md"
    printf 'environment: homelab | lab\n' > "$HQ_SCHEMA_DOC"

    run hq_bin schema --check

    [ "$status" -eq 1 ]
    [[ "$output" == *"vault Frontmatter Schema doc lists stale enum values"* ]]
    [[ "$output" == *"lab"* ]]
}
