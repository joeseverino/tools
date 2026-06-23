#!/usr/bin/env bats
# backlog.bats — backlog is a thin client over the vault MCP's task brain. It
# holds no task logic: reads shell out to `severino-vault-mcp task-list` (and
# render its JSON), writes to `task-add` / `task-move`. These assert the
# delegation (the right MCP subcommand + flags) and the rendering, with the MCP
# stubbed — no vault, no real MCP.

load helpers

backlog() { "$TOOLS_HOME/bin/backlog" "$@"; }

# A hermetic severino-vault-mcp stub: it logs its argv to $SVMC_LOG and emits the
# canned JSON the real CLI would. $SVMC_FAIL=1 makes writes return the error
# envelope, so the failure path is exercised without a real vault.
setup() {
    export SVMC_LOG="$BATS_TEST_TMPDIR/svmc.log"
    STUB="$BATS_TEST_TMPDIR/severino-vault-mcp"
    cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SVMC_LOG"
case "$1" in
  task-list)
    cat <<'JSON'
{"ok":true,"stale_days":14,"count":2,"total":2,"counts":{"status":{"open":2},"project":{"cordon":1,"cross":1},"stale":1},
"tasks":[
{"doc_id":"task-v4-semantics","slug":"v4-semantics","title":"Tighten v4","status":"open","project":"cordon","related_projects":["cordon"],"effort":"M","priority":"high","created":"2026-06-01","closed":"","tags":["backlog"],"relative_path":"01 Projects/cordon/tasks/task-v4-semantics.md","age_days":0,"stale":false},
{"doc_id":"task-ci-parity","slug":"ci-parity","title":"CI parity gate","status":"open","project":"cross","related_projects":["cordon","tools"],"effort":"M","priority":"med","created":"2026-05-01","closed":"","tags":["backlog"],"relative_path":"07 Backlog/task-ci-parity.md","age_days":40,"stale":true}]}
JSON
    ;;
  task-add)
    [[ "${SVMC_FAIL:-0}" == 1 ]] && { echo '{"ok":false,"error":"no such project: nope"}'; exit 1; }
    echo '{"ok":true,"doc_id":"task-new-thing","relative_path":"01 Projects/tools/tasks/task-new-thing.md","project":"tools","status":"open"}'
    ;;
  task-move)
    [[ "${SVMC_FAIL:-0}" == 1 ]] && { echo '{"ok":false,"error":"no task matches: ghost"}'; exit 1; }
    echo "{\"ok\":true,\"doc_id\":\"task-$2\",\"status\":\"$3\",\"previous\":\"open\",\"relative_path\":\"07 Backlog/task-$2.md\"}"
    ;;
esac
STUBEOF
    chmod +x "$STUB"
    export SVMC_BIN="$STUB"
}

@test "help and describe work with no env (command-surface contract)" {
    run "$TOOLS_HOME/bin/backlog" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"thin client over the vault MCP"* ]]
    run "$TOOLS_HOME/bin/backlog" --describe
    [ "$status" -eq 0 ]
    [[ "$output" == *'"name":"backlog"'* ]]
}

@test "board renders the MCP task-list JSON, grouped by project" {
    run backlog
    [ "$status" -eq 0 ]
    [[ "$output" == *"cordon"* ]]
    [[ "$output" == *"v4-semantics"* ]]
    [[ "$output" == *"ci-parity"* ]]
    # the cross-cutting bucket is its own group
    [[ "$output" == *"cross"* ]]
}

@test "default board calls task-list with no visibility flags" {
    backlog >/dev/null
    grep -q '^task-list$' "$SVMC_LOG"
}

@test "--json passes the MCP JSON through untouched" {
    run backlog --json
    [ "$status" -eq 0 ]
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["total"]==2' "$output"
}

@test "filters map onto the MCP flags" {
    backlog --status active --project cordon --all >/dev/null
    grep -q 'task-list --status active --project cordon --all' "$SVMC_LOG"
}

@test "stale view maps to --stale-only, --days to --stale-days" {
    backlog stale --days 7 >/dev/null
    grep -q 'task-list --stale-only --stale-days 7' "$SVMC_LOG"
}

@test "add delegates to task-add with the title and flags, then reports" {
    run backlog add "New thing" --project tools --effort M
    [ "$status" -eq 0 ]
    [[ "$output" == *"captured"* ]]
    [[ "$output" == *"task-new-thing"* ]]
    grep -q 'task-add New thing --project tools --effort M' "$SVMC_LOG"
}

@test "move delegates to task-move; close maps to done" {
    backlog move v4-semantics active >/dev/null
    grep -q 'task-move v4-semantics active' "$SVMC_LOG"
    backlog close v4-semantics >/dev/null
    grep -q 'task-move v4-semantics done' "$SVMC_LOG"
}

@test "an MCP error envelope surfaces as a failure" {
    SVMC_FAIL=1 run backlog close ghost
    [ "$status" -eq 1 ]
    [[ "$output" == *"no task matches"* ]]
}

@test "add with no title is a usage error" {
    run backlog add
    [ "$status" -eq 2 ]
    [[ "$output" == *"needs a title"* ]]
}
