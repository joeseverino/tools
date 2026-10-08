#!/usr/bin/env bats
# The node:test suite under tests/unit/ (pure functions and the lib/ helpers).

load helpers

@test "node unit tests pass" {
    cd "$TOOLS_HOME"
    run npm test --silent
    [ "$status" -eq 0 ] || { printf '%s\n' "$output"; false; }
}
