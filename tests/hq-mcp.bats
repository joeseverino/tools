#!/usr/bin/env bats

load helpers

setup() {
    export TEST_ROOT="$BATS_TEST_TMPDIR/hq-mcp"
    export TEST_BIN="$TEST_ROOT/bin"
    export NOTES_HOME="$TEST_ROOT/vault"
    export HQ_LOCAL_PATH="$TEST_ROOT/hq"
    export HQ_URL="https://hq.example.test"
    export HQ_MCP_CLIENT="$TEST_BIN/hq-mcp-client"
    export HQ_MCP_LOG="$TEST_ROOT/mcp-request.json"
    mkdir -p "$TEST_BIN" "$NOTES_HOME" "$HQ_LOCAL_PATH/docs_index"
    export PATH="$TEST_BIN:$PATH"

    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  --help) printf '%s\n' 'commands: hq-manifest topology schema' ;;
  hq-manifest) printf '%s\n' '[{"doc_id":"rb-one","title":"One","doc_type":"runbook","status":"active"}]' ;;
  topology) printf '%s\n' '{"version":3,"hosts":[],"pki":[],"externals":[],"dependencies":[],"managed_resources":[]}' ;;
  schema) printf '%s\n' '{}' ;;
esac
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"

    cat > "$HQ_MCP_CLIENT" <<'SH'
#!/usr/bin/env bash
tee "$HQ_MCP_LOG" >/dev/null
case "$(jq -r .tool "$HQ_MCP_LOG")" in
  execute_capability)
    if [[ "$(jq -r .arguments.name "$HQ_MCP_LOG")" == "hq.sync" ]]; then
      printf '%s\n' '{"ok":true,"documentation":{"stats":{"created":1,"updated":0,"missing_relations":0,"orphans":[],"content_items_synced":1}},"topology":{"schema_version":3,"checksum":"1234567890abcdef","scheduled":[]}}'
    else
      printf '%s\n' '{"ok":true,"created":true,"project":{"slug":"example"}}'
    fi ;;
  audit_registry) printf '%s\n' '{"ok":true,"projects_total":1,"assets_total":1,"orphan_projects":[],"orphan_assets":[]}' ;;
  export_year_summary) printf '%s\n' '{"ok":true,"filename":"year-summary-2026.md","format":"md","content":"# 2026"}' ;;
  describe_capabilities) printf '%s\n' '{"ok":true,"capabilities":[{"name":"project.upsert","summary":"Idempotently create or update an HQ project by slug.","input_schema":{"required":["name"],"properties":{"slug":{"type":"string","default":""},"name":{"type":"string"},"status":{"type":"string","default":"idea"}}}}]}' ;;
esac
SH
    chmod +x "$HQ_MCP_CLIENT"

    cat > "$TEST_BIN/ssh" <<'SH'
#!/usr/bin/env bash
echo 'SSH MUST NOT RUN' >&2
exit 99
SH
    chmod +x "$TEST_BIN/ssh"
}

hq_bin() { "$TOOLS_HOME/bin/hq" "$@"; }

@test "hq sync sends manifest and topology in one MCP capability call" {
    run hq_bin sync

    [ "$status" -eq 0 ]
    [ "$(jq -r .arguments.name "$HQ_MCP_LOG")" = "hq.sync" ]
    [ "$(jq -r '.arguments.payload.manifest[0].doc_id' "$HQ_MCP_LOG")" = "rb-one" ]
    [ "$(jq -r '.arguments.payload.topology.version' "$HQ_MCP_LOG")" = "3" ]
    [[ "$output" == *"HQ is in sync"* ]]
    [[ "$output" != *"SSH MUST NOT RUN"* ]]
}

@test "hq validate is a read-only MCP call" {
    run hq_bin validate

    [ "$status" -eq 0 ]
    [ "$(jq -r .tool "$HQ_MCP_LOG")" = "audit_registry" ]
    [[ "$output" == *"every Project and Asset is referenced"* ]]
}

@test "hq create maps ergonomic aliases to the server-owned upsert schema" {
    run hq_bin create project example --name Example --repo https://example.test/repo

    [ "$status" -eq 0 ]
    [ "$(jq -r .arguments.name "$HQ_MCP_LOG")" = "project.upsert" ]
    [ "$(jq -r .arguments.payload.repository_url "$HQ_MCP_LOG")" = "https://example.test/repo" ]
    [[ "$output" == *"example: created"* ]]
}

@test "hq export uses MCP and writes the returned canonical filename" {
    cd "$TEST_ROOT"

    run hq_bin export 2026 md

    [ "$status" -eq 0 ]
    [ "$(jq -r .tool "$HQ_MCP_LOG")" = "export_year_summary" ]
    [ "$(cat year-summary-2026.md)" = "# 2026" ]
}

@test "hq create focused help renders the live capability schema" {
    run hq_bin create project -h

    [ "$status" -eq 0 ]
    [ "$(jq -r .tool "$HQ_MCP_LOG")" = "describe_capabilities" ]
    [[ "$output" == *"--name"*"required"* ]]
    [[ "$output" == *"--status"*"default: 'idea'"* ]]
}
