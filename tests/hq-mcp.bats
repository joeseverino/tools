#!/usr/bin/env bats

load helpers

setup() {
    export TEST_ROOT="$BATS_TEST_TMPDIR/hq-mcp"
    export TEST_BIN="$TEST_ROOT/bin"
    export NOTES_HOME="$TEST_ROOT/vault"
    export HQ_LOCAL_PATH="$TEST_ROOT/hq"
    export HQ_CALL="$TEST_BIN/hq-call"
    export HQ_CALL_LOG="$TEST_ROOT/mcp-request.json"
    mkdir -p "$TEST_BIN" "$NOTES_HOME" "$HQ_LOCAL_PATH/hq/domains/docs_index"
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

    cat > "$HQ_CALL" <<'SH'
#!/usr/bin/env bash
tee "$HQ_CALL_LOG" >/dev/null
case "$(jq -r .tool "$HQ_CALL_LOG")" in
  execute_capability)
    printf '%s\n' '{"ok":true,"stats":{"created":1,"updated":0,"missing_relations":0,"orphans":[],"content_items_synced":1},"message":"Manifest imported: 1 new, 0 changed, 0 unchanged."}' ;;
  audit_registry) printf '%s\n' '{"ok":true,"projects_total":1,"assets_total":1,"orphan_projects":[],"orphan_assets":[]}' ;;
esac
SH
    chmod +x "$HQ_CALL"

    cat > "$TEST_BIN/ssh" <<'SH'
#!/usr/bin/env bash
echo 'SSH MUST NOT RUN' >&2
exit 99
SH
    chmod +x "$TEST_BIN/ssh"
}

hq_bin() { "$TOOLS_HOME/bin/hq" "$@"; }

# HQ derives its own infrastructure picture, so the manifest is all sync carries.
# It used to send an authored topology too: HQ ignored it (HQSyncCommand has no
# such field) and returned none, so the reporting step then subscripted null and
# hq sync died printing its own summary -- after the write had already landed.
@test "hq sync sends the manifest, and no topology, in one MCP capability call" {
    run hq_bin sync

    [ "$status" -eq 0 ]
    [ "$(jq -r .arguments.name "$HQ_CALL_LOG")" = "documentation.sync" ]
    [ "$(jq -r '.arguments.payload.manifest[0].doc_id' "$HQ_CALL_LOG")" = "rb-one" ]
    [ "$(jq -r '.arguments.payload | has("topology")' "$HQ_CALL_LOG")" = "false" ]
    [[ "$output" == *"HQ is in sync"* ]] || return 1
    [[ "$output" != *"Topology"* ]] || return 1
    [[ "$output" != *"SSH MUST NOT RUN"* ]]
}

@test "hq validate is a read-only MCP call" {
    run hq_bin validate

    [ "$status" -eq 0 ]
    [ "$(jq -r .tool "$HQ_CALL_LOG")" = "audit_registry" ]
    [[ "$output" == *"every Project and Asset is referenced"* ]]
}
