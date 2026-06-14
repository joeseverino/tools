#!/usr/bin/env bats
# cordon-schema.bats — the vendored command-surface schema (schemas/cordon-v4.json)
# must not drift from the canonical cordon repo. Guards
# lib/tools/describe.sh:cordon_schema_status, the logic behind the "cordon
# schema" line in `tools check` and `tools doctor`.

load helpers

# Run cordon_schema_status with a given CORDON_HOME, echo the resulting status.
status_for() {
    CORDON_HOME="$1" bash -c '
        source "$TOOLS_HOME/lib/common.sh"
        source "$TOOLS_HOME/lib/tools/describe.sh"
        cordon_schema_status
        printf "%s\n" "$CORDON_STATUS"
    '
}

@test "synced when the canonical schema matches the vendored copy" {
    local home="$BATS_TEST_TMPDIR/cordon"
    mkdir -p "$home/schema"
    cp "$TOOLS_HOME/schemas/cordon-v4.json" "$home/schema/cordon-v4.json"
    run status_for "$home"
    [ "$status" -eq 0 ]
    [ "$output" = "synced" ]
}

@test "drifted when the canonical schema differs" {
    local home="$BATS_TEST_TMPDIR/cordon"
    mkdir -p "$home/schema"
    printf '{"changed":true}\n' > "$home/schema/cordon-v4.json"
    run status_for "$home"
    [ "$output" = "drifted" ]
}

@test "absent when the cordon repo is not found" {
    run status_for "$BATS_TEST_TMPDIR/nonexistent"
    [ "$output" = "absent" ]
}
