#!/usr/bin/env bats
# site-mcp.bats — installed/source MCP drift handling for site commands.

load helpers

setup() {
    export TEST_ROOT="$BATS_TEST_TMPDIR/mcp-drift"
    export TEST_BIN="$TEST_ROOT/bin"
    export MCP_HOME="$TEST_ROOT/source"
    export MCP_STATE="$TEST_ROOT/installed-fingerprint"
    export SITE_HOME="$TEST_ROOT/site"
    export NOTES_HOME="$TEST_ROOT/vault"
    export MCP_CALL_LOG="$TEST_ROOT/mcp-calls.log"
    mkdir -p "$TEST_BIN" "$MCP_HOME/src/severino_vault_mcp" "$SITE_HOME" "$NOTES_HOME"
    printf 'value = 1\n' > "$MCP_HOME/src/severino_vault_mcp/example.py"
    printf '{}\n' > "$SITE_HOME/package.json"

    export SOURCE_FP
    SOURCE_FP="$(MCP_SRC="$MCP_HOME/src/severino_vault_mcp" node -e '
        const crypto = require("node:crypto");
        const fs = require("node:fs");
        const path = require("node:path");
        const dir = process.env.MCP_SRC;
        const hash = crypto.createHash("sha256");
        for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".py")).sort()) {
            hash.update(name); hash.update(Buffer.from([0]));
            hash.update(fs.readFileSync(path.join(dir, name))); hash.update(Buffer.from([0]));
        }
        process.stdout.write(hash.digest("hex").slice(0, 16));
    ')"
    printf 'stale-fingerprint\n' > "$MCP_STATE"

    cat > "$TEST_BIN/severino-vault-mcp" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
    --fingerprint) cat "$MCP_STATE" ;;
    technology-catalog)
        printf '%s\n' '{"ok":true,"by_group":{"Test":[{"slug":"test","label":"Test","featured":false}]}}'
        ;;
    validate-all-writeups)
        printf '%s\n' "validate-all-writeups" >> "$MCP_CALL_LOG"
        printf '%s\n' '{"ok":true,"writeups":[]}'
        ;;
    prepare-writeup-publish)
        printf '%s\n' "prepare-writeup-publish" >> "$MCP_CALL_LOG"
        printf '%s\n' '{"ok":true}'
        ;;
    *) printf '%s\n' '{"ok":true}' ;;
esac
SH
    chmod +x "$TEST_BIN/severino-vault-mcp"

    cat > "$TEST_BIN/hq" <<'SH'
#!/usr/bin/env bash
exit "${HQ_TEST_EXIT:-0}"
SH
    chmod +x "$TEST_BIN/hq"

    cat > "$TEST_BIN/uv" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$SOURCE_FP" > "$MCP_STATE"
SH
    chmod +x "$TEST_BIN/uv"
    export PATH="$TEST_BIN:$PATH"
}

site_bin() {
    "$TOOLS_HOME/bin/site" "$@"
}

@test "noninteractive stale MCP fails with concise reinstall guidance" {
    run site_bin tech

    [ "$status" -ne 0 ]
    [[ "$output" == *"installed severino-vault-mcp (stale-fingerprint) does not match source ($SOURCE_FP)"* ]]
    [[ "$output" == *"run \`site reinstall-mcp --yes\`, then retry"* ]]
    [[ "$output" != *"invalid choice"* ]]
    [[ "$output" != *"usage: severino-vault-mcp"* ]]
}

@test "auto reinstall refreshes the MCP then continues the command" {
    export SITE_MCP_AUTO_REINSTALL=1
    run site_bin tech

    [ "$status" -eq 0 ]
    [[ "$output" == *"stale"* ]]
    [[ "$output" == *"reinstalled"* ]]
    [[ "$output" == *"test"* ]]
    [ "$(cat "$MCP_STATE")" = "$SOURCE_FP" ]
}

@test "publish-writeup runs the authoritative batch gate once" {
    export SITE_SKIP_MCP_DRIFT_CHECK=1
    export HQ_TEST_EXIT=1
    # publish-writeup only opens a PR (remote_write), so it runs the gate
    # without the deploy bypass — landing the PR is the gated deploy.
    mkdir -p "$NOTES_HOME/05 Writeups/example"

    run site_bin publish-writeup example

    [ "$status" -ne 0 ]
    [ "$(grep -c '^validate-all-writeups$' "$MCP_CALL_LOG")" -eq 1 ]
    ! grep -q '^prepare-writeup-publish$' "$MCP_CALL_LOG"
    [[ "$output" == *"all published writeups pass (including example)"* ]]
}

@test "deploy command is gated non-interactively without TOOLS_ASSUME_YES" {
    # The blast-radius gate: a deploy (land) must fail closed when run
    # non-interactively without the explicit bypass — before any flow runs, so
    # the MCP batch gate is never even reached.
    export SITE_SKIP_MCP_DRIFT_CHECK=1

    run site_bin land

    [ "$status" -eq 2 ]
    [[ "$output" == *"deploy"* ]]
    [[ "$output" == *"TOOLS_ASSUME_YES=1"* ]]
    [ ! -f "$MCP_CALL_LOG" ]
}
