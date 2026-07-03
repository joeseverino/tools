#!/usr/bin/env bats
# engine-lock.bats — the vault-engine consumer fleet must pin ONE engine
# commit. Guards lib/tools/engine.sh (engine_consumers / engine_lock_pin)
# and `tools bump-engine`'s parity verdict; the same helpers back the
# "engine lock parity" line in `tools doctor`.

load helpers

# write_lock <dir> <version> [sha] — a minimal uv.lock pinning
# severino-vault-engine, git-sourced when a sha is given, registry otherwise.
write_lock() {
    local dir="$1" version="$2" sha="${3:-}"
    mkdir -p "$dir"
    {
        printf '[[package]]\nname = "mcp"\nversion = "1.9.0"\n\n'
        printf '[[package]]\nname = "severino-vault-engine"\nversion = "%s"\n' "$version"
        if [[ -n "$sha" ]]; then
            printf 'source = { git = "https://github.com/joeseverino/vault-engine#%s" }\n' "$sha"
        else
            printf 'source = { registry = "https://pypi.org/simple" }\n'
        fi
    } > "$dir/uv.lock"
}

pin_for() {
    bash -c '
        source "$TOOLS_HOME/lib/common.sh"
        source "$TOOLS_HOME/lib/tools/engine.sh"
        engine_lock_pin "$1"
    ' _ "$1"
}

# stub_uv — a no-op uv that logs each invocation to $UV_LOG.
stub_uv() {
    export UV_BIN="$BATS_TEST_TMPDIR/uv" UV_LOG="$BATS_TEST_TMPDIR/uv.log"
    printf '#!/usr/bin/env bash\necho "$*" >> "$UV_LOG"\n' > "$UV_BIN"
    chmod +x "$UV_BIN"
    : > "$UV_LOG"
}

@test "engine_lock_pin parses version and short sha from a git-pinned lock" {
    write_lock "$BATS_TEST_TMPDIR/a" "0.1.1" "b4f557e59fe0d4d1e5821bb3dbab49041c8e4bd9"
    run pin_for "$BATS_TEST_TMPDIR/a"
    [ "$status" -eq 0 ] && [ "$output" = "0.1.1 @b4f557e59fe0" ]
}

@test "engine_lock_pin prints bare version for a registry source" {
    write_lock "$BATS_TEST_TMPDIR/a" "0.1.3"
    run pin_for "$BATS_TEST_TMPDIR/a"
    [ "$status" -eq 0 ] && [ "$output" = "0.1.3" ]
}

@test "engine_lock_pin is empty when uv.lock is missing" {
    run pin_for "$BATS_TEST_TMPDIR/nonexistent"
    [ "$status" -eq 0 ] && [ -z "$output" ]
}

@test "bump-engine --lock-only re-locks both consumers and reports parity" {
    write_lock "$BATS_TEST_TMPDIR/vault-mcp" "0.1.1" "b4f557e59fe0d4d1e5821bb3dbab49041c8e4bd9"
    write_lock "$BATS_TEST_TMPDIR/edu-mcp"   "0.1.1" "b4f557e59fe0d4d1e5821bb3dbab49041c8e4bd9"
    stub_uv
    MCP_HOME="$BATS_TEST_TMPDIR/vault-mcp" EDU_MCP_HOME="$BATS_TEST_TMPDIR/edu-mcp" \
        run "$TOOLS_HOME/bin/tools" bump-engine --lock-only
    [ "$status" -eq 0 ] \
        && grep -qF "both consumers pin severino-vault-engine 0.1.1 @b4f557e59fe0" <<<"$output" \
        && [ "$(grep -c "lock --upgrade-package severino-vault-engine" "$UV_LOG")" -eq 2 ] \
        && ! grep -q "tool install" "$UV_LOG"
}

@test "bump-engine fails when the consumers still disagree after the bump" {
    write_lock "$BATS_TEST_TMPDIR/vault-mcp" "0.1.3" "fbf5db6b5ba43c99199f64e90c87f89bb74600c9"
    write_lock "$BATS_TEST_TMPDIR/edu-mcp"   "0.1.1" "b4f557e59fe0d4d1e5821bb3dbab49041c8e4bd9"
    stub_uv
    MCP_HOME="$BATS_TEST_TMPDIR/vault-mcp" EDU_MCP_HOME="$BATS_TEST_TMPDIR/edu-mcp" \
        run "$TOOLS_HOME/bin/tools" bump-engine --lock-only
    [ "$status" -eq 1 ] && grep -qF "consumers still disagree" <<<"$output"
}

@test "bump-engine without --lock-only also reinstalls each uv tool" {
    write_lock "$BATS_TEST_TMPDIR/vault-mcp" "0.1.1" "b4f557e59fe0d4d1e5821bb3dbab49041c8e4bd9"
    write_lock "$BATS_TEST_TMPDIR/edu-mcp"   "0.1.1" "b4f557e59fe0d4d1e5821bb3dbab49041c8e4bd9"
    stub_uv
    MCP_HOME="$BATS_TEST_TMPDIR/vault-mcp" EDU_MCP_HOME="$BATS_TEST_TMPDIR/edu-mcp" \
        run "$TOOLS_HOME/bin/tools" bump-engine
    [ "$status" -eq 0 ] && [ "$(grep -c "tool install --reinstall ." "$UV_LOG")" -eq 2 ]
}
