#!/usr/bin/env bats
# repos-project.bats — `repos` as the one read owner of the fleet.

load helpers

@test "repos --json NAME prefers an exact repo-name match over substring" {
    export CODE_HOME="$BATS_TEST_TMPDIR/code"
    mkdir -p "$CODE_HOME/Assets/cordon" "$CODE_HOME/Assets/cordon-starter"
    git -C "$CODE_HOME/Assets/cordon" init -q
    git -C "$CODE_HOME/Assets/cordon-starter" init -q
    # "cordon" is also a substring of "cordon-starter"; exact name must win so a
    # ship/land/resync scoped to `cordon` never touches the sibling.
    run "$TOOLS_HOME/bin/repos" --json cordon
    exact="$output"
    # a partial name with no exact match still falls back to substring (both).
    run "$TOOLS_HOME/bin/repos" --json cord
    # One python check asserts both (the last command, so bats 1.13 gates it):
    # exact name -> only cordon; partial -> substring (both).
    python3 -c '
import json,sys
e=sorted(r["name"] for r in json.loads(sys.argv[1])["repos"])
s=sorted(r["name"] for r in json.loads(sys.argv[2])["repos"])
assert e==["cordon"], e
assert s==["cordon","cordon-starter"], s
' "$exact" "$output"
}

@test "repos --json satisfies the fleet contract schema (the backend guarantee)" {
    export CODE_HOME="$BATS_TEST_TMPDIR/code"
    mkdir -p "$CODE_HOME/Projects/demo"
    git -C "$CODE_HOME/Projects/demo" init -q
    git -C "$CODE_HOME/Projects/demo" config user.email t@t.io
    git -C "$CODE_HOME/Projects/demo" config user.name tester
    printf 'x\n' > "$CODE_HOME/Projects/demo/f.txt"
    git -C "$CODE_HOME/Projects/demo" add f.txt
    git -C "$CODE_HOME/Projects/demo" commit -q -m "feat: x"
    # the live emitter must validate against the published contract
    "$TOOLS_HOME/bin/repos" --json \
        | node "$TOOLS_HOME/lib/tools/validate-json.ts" "$TOOLS_HOME/schemas/repos.schema.json"
}

@test "validate-json + repos schema: accepts a minimal doc, rejects a missing field" {
    local v="$TOOLS_HOME/lib/tools/validate-json.ts" s="$TOOLS_HOME/schemas/repos.schema.json"
    # one chained statement so each clause gates under bats' last-command errexit:
    # a minimal valid doc passes, and dropping a required key is actually caught.
    printf '%s' '{"ok":true,"roots":[],"count":0,"repos":[]}' | node "$v" "$s" \
        && ! printf '%s' '{"ok":true,"roots":[],"count":0}' | node "$v" "$s"
}
