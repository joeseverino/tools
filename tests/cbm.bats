#!/usr/bin/env bats
# cbm — codebase-memory-mcp health + recovery.
# Hermetic: runtime dirs, cache and logs all live under $BATS_TEST_TMPDIR, the
# MCP binary is a stub, and process lookup is stubbed through $CBM_PGREP_BIN,
# so nothing here can see or kill the machine's real CBM daemons.

load helpers

setup() {
    export CBM_TMP_DIR="$BATS_TEST_TMPDIR/tmp"
    export CBM_CACHE_DIR="$BATS_TEST_TMPDIR/cache"
    export CBM_RUNTIME="$CBM_TMP_DIR/cbm-daemon-$(id -u)"
    mkdir -p "$CBM_RUNTIME" "$CBM_CACHE_DIR/logs"

    # A healthy runtime dir: a socket that still has its identity file.
    touch "$CBM_RUNTIME/cbm-live.sock" "$CBM_RUNTIME/cbm-live.sock.identity"

    stub_bin ok
    stub_pgrep
}

# stub_bin <ok|wedged> — a fake codebase-memory-mcp. "ok" answers the
# initialize handshake; "wedged" reproduces the real failure (no result, and
# the client waits) so the timeout path is exercised without a 30s test.
stub_bin() {
    export CBM_BIN="$BATS_TEST_TMPDIR/cbm-stub"
    if [[ $1 == ok ]]; then
        cat > "$CBM_BIN" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo '{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"stub"}}}'
EOF
    else
        cat > "$CBM_BIN" <<'EOF'
#!/usr/bin/env bash
sleep 30
EOF
    fi
    chmod +x "$CBM_BIN"
}

# stub_pgrep [pid...] — a fake pgrep returning exactly these pids (none by
# default), so `fix` never reads the real process table.
stub_pgrep() {
    export CBM_PGREP_BIN="$BATS_TEST_TMPDIR/pgrep-stub"
    printf '#!/usr/bin/env bash\n' > "$CBM_PGREP_BIN"
    for pid in "$@"; do printf 'echo %s\n' "$pid" >> "$CBM_PGREP_BIN"; done
    printf 'exit 0\n' >> "$CBM_PGREP_BIN"
    chmod +x "$CBM_PGREP_BIN"
}

damage() { touch "$CBM_RUNTIME/cbm-dead.sock"; }   # a socket with no .identity

@test "help renders with no environment configured" {
    run env -u CBM_TMP_DIR -u CBM_CACHE_DIR "$TOOLS_HOME/bin/cbm" --help
    [ "$status" -eq 0 ] && grep -qF "cbm [status]" <<<"$output" \
        && grep -qF "fix" <<<"$output" && grep -qF "prune" <<<"$output"
}

@test "--describe emits every command in the dispatch" {
    run "$TOOLS_HOME/bin/cbm" --describe
    [ "$status" -eq 0 ] && printf '%s' "$output" | python3 -c '
import json, sys
d = json.load(sys.stdin)
names = {c["name"] for c in d["commands"]}
assert names == {"status", "fix", "prune"}, names
assert d["name"] == "cbm" and d["schema_version"] == 4, d["name"]
assert d["group"] == "Diagnostics" and d["order"] == 85, (d["group"], d["order"])
'
}

@test "status passes on a healthy runtime dir" {
    run "$TOOLS_HOME/bin/cbm" status
    [ "$status" -eq 0 ] && grep -qF "all checks passed" <<<"$output"
}

@test "status fails when a socket has lost its identity file" {
    damage
    run "$TOOLS_HOME/bin/cbm" status
    [ "$status" -eq 1 ] && grep -qF "socket identity intact" <<<"$output" \
        && grep -qF "1 socket" <<<"$output" && grep -qF "cbm fix" <<<"$output"
}

@test "status fails when the handshake does not come back" {
    stub_bin wedged
    run "$TOOLS_HOME/bin/cbm" status --timeout 2
    [ "$status" -eq 1 ] && grep -qF "MCP handshake" <<<"$output" \
        && grep -qF "timeout" <<<"$output"
}

@test "status --json is valid JSON carrying the verdict" {
    damage
    run "$TOOLS_HOME/bin/cbm" status --json
    [ "$status" -eq 1 ] && printf '%s' "$output" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["ok"] is False, d
labels = {c["label"]: c for c in d["checks"]}
assert labels["socket identity intact"]["ok"] is False, labels
'
}

@test "status warns before the reaper wedges it" {
    touch -t 202601010000 "$CBM_RUNTIME/cbm-live.sock.identity"
    run "$TOOLS_HOME/bin/cbm" status
    # Still usable, so still exit 0 — but warned about the coming reap.
    [ "$status" -eq 0 ] && grep -qF "reaper exposure" <<<"$output"
}

@test "worker logs warn on size, not on a high count of fresh files" {
    # CBM writes a worker log per index pass, so a busy repo produces thousands
    # of fresh files that prune cannot touch. Count must not trip the warning.
    for n in $(seq 1 60); do : > "$CBM_CACHE_DIR/logs/.worker-log-$n"; done
    run "$TOOLS_HOME/bin/cbm" status --no-probe
    [ "$status" -eq 0 ] && ! grep -qF "index-worker logs" <<<"$output"
}

@test "worker logs warn once they actually take up space" {
    mkfile -n 2m "$CBM_CACHE_DIR/logs/.worker-log-big" 2>/dev/null \
        || dd if=/dev/zero of="$CBM_CACHE_DIR/logs/.worker-log-big" bs=1m count=2 2>/dev/null
    CBM_LOG_WARN_MB=1 run "$TOOLS_HOME/bin/cbm" status --no-probe
    [ "$status" -eq 0 ] && grep -qF "index-worker logs" <<<"$output" \
        && grep -qF "cbm prune" <<<"$output"
}

@test "fix --dry-run kills nothing and removes nothing" {
    stub_pgrep 4242
    run "$TOOLS_HOME/bin/cbm" fix --dry-run
    [ "$status" -eq 0 ] && grep -qF "would kill pid 4242" <<<"$output" \
        && grep -qF "nothing changed" <<<"$output" \
        && [ -d "$CBM_RUNTIME" ] && [ -f "$CBM_RUNTIME/cbm-live.sock" ]
}

@test "fix clears the stale runtime dir and verifies the handshake" {
    damage
    run "$TOOLS_HOME/bin/cbm" fix
    [ "$status" -eq 0 ] && grep -qF "verified" <<<"$output" \
        && [ ! -d "$CBM_RUNTIME" ]
}

@test "fix reports failure when the handshake still does not come back" {
    stub_bin wedged
    run "$TOOLS_HOME/bin/cbm" fix
    [ "$status" -eq 1 ] && grep -qF "failed" <<<"$output"
}

@test "prune deletes stale worker logs and keeps fresh ones" {
    touch -t 202601010000 "$CBM_CACHE_DIR/logs/.worker-log-old"
    touch "$CBM_CACHE_DIR/logs/.worker-log-new"
    run "$TOOLS_HOME/bin/cbm" prune --days 14
    [ "$status" -eq 0 ] && [ ! -f "$CBM_CACHE_DIR/logs/.worker-log-old" ] \
        && [ -f "$CBM_CACHE_DIR/logs/.worker-log-new" ]
}

@test "prune is a clean no-op when nothing is stale" {
    touch "$CBM_CACHE_DIR/logs/.worker-log-new"
    run "$TOOLS_HOME/bin/cbm" prune
    [ "$status" -eq 0 ] && grep -qF "no index-worker logs older than" <<<"$output" \
        && [ -f "$CBM_CACHE_DIR/logs/.worker-log-new" ]
}

@test "an unknown command is a usage error" {
    run "$TOOLS_HOME/bin/cbm" bogus
    [ "$status" -eq 2 ] && grep -qF "unknown command" <<<"$output"
}

@test "an unknown flag is a usage error scoped to the command" {
    run "$TOOLS_HOME/bin/cbm" prune --bogus
    [ "$status" -eq 2 ] && grep -qF "unknown option" <<<"$output"
}
