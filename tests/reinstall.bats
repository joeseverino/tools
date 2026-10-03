#!/usr/bin/env bats
# reinstall.bats — `tools reinstall` runs a repository's declared install, then
# verifies the installed fingerprint against the checkout's own.

load helpers

# manifest <installed-fp> <source-fp> — one repository whose install is a
# stubbed uv and whose two fingerprint commands print the given values.
manifest() {
    local bin="$BATS_TEST_TMPDIR/bin"
    mkdir -p "$bin" "$BATS_TEST_TMPDIR/code/Assets/demo"
    export CODE_HOME="$BATS_TEST_TMPDIR/code" UV_LOG="$BATS_TEST_TMPDIR/uv.log"
    export UV_BIN="$bin/uv" TOOLS_CAPABILITIES="$BATS_TEST_TMPDIR/capabilities.json"
    printf '#!/usr/bin/env bash\necho "$*" >> "$UV_LOG"\n' > "$UV_BIN"
    printf '#!/usr/bin/env bash\necho %s\n' "$1" > "$bin/demo-installed"
    printf '#!/usr/bin/env bash\necho %s\n' "$2" > "$bin/demo-source"
    chmod +x "$UV_BIN" "$bin/demo-installed" "$bin/demo-source"
    cat > "$TOOLS_CAPABILITIES" <<JSON
{"capabilities_version":1,"repositories":[{"id":"demo","path":"Assets/demo",
 "install":["uv","tool","install",".","--force","--reinstall"],
 "fingerprint":{"installed":["$bin/demo-installed"],"source":["$bin/demo-source"]}}]}
JSON
}

@test "reinstall runs the declared install and passes when the fingerprints match" {
    manifest abc123 abc123
    run "$TOOLS_HOME/bin/tools" reinstall demo
    [ "$status" -eq 0 ]
    grep -qF "tool install . --force --reinstall" "$UV_LOG"
    [[ "$output" == *"reinstalled"*"demo abc123"* ]]
}

@test "reinstall fails when the installed copy still differs from the checkout" {
    manifest abc123 def456
    run "$TOOLS_HOME/bin/tools" reinstall demo
    [ "$status" -eq 1 ]
    [[ "$output" == *"installed abc123, source def456"* ]]
}

@test "reinstall refuses a repository that declares no install" {
    manifest abc123 abc123
    run "$TOOLS_HOME/bin/tools" reinstall nothing-here
    [ "$status" -ne 0 ]
    [[ "$output" == *"declares no install"* ]]
}
