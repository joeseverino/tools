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
