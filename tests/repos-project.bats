#!/usr/bin/env bats
# repos-project.bats — the shared read-side projection. `repos` is the one read
# owner; lib/repos/project.mjs is the one way the loop's write tools consume it,
# so ship/land/resync each declare only a filter + columns, not a second copy of
# the stdin/parse loop. These assert the shared reader's contract and each
# driver's projection over it.

load helpers

plan() { # plan <module.mjs> <json-payload>  [env=val ...]
    local mod="$1" payload="$2"; shift 2
    env "$@" bash -c 'printf "%s" "$2" | node "$TOOLS_HOME/$1"' _ "$mod" "$payload"
}

@test "shared reader: garbage in -> empty out (never throws)" {
    run plan lib/resync/plan.mjs 'not json at all'
    [ "$status" -eq 0 ]
    [ "$output" = "" ]
}

@test "shared reader: a row function returning null drops that repo" {
    payload='{"repos":[{"name":"a","path":"/a","git":true,"has_remote":true,"dirty":2},{"name":"b","path":"/b","git":true,"has_remote":false}]}'
    run plan lib/resync/plan.mjs "$payload"
    [ "$status" -eq 0 ]
    # b has no remote -> dropped; only a survives, with dirty=2
    [ "$output" = $'a\t/a\t2' ]
}

@test "resync plan: only git repos with a remote, dirty = dirty+untracked" {
    payload='{"repos":[{"name":"x","path":"/x","git":true,"has_remote":true,"dirty":1,"untracked":2},{"name":"nogit","path":"/n","git":false,"has_remote":true}]}'
    run plan lib/resync/plan.mjs "$payload"
    [ "$output" = $'x\t/x\t3' ]
}

@test "land plan: only repos with an OPEN PR, projected to land's columns" {
    payload='{"repos":[{"name":"g","path":"/g","pr":{"state":"open","number":12,"ci":"passing","url":"u12"}},{"name":"closed","path":"/c","pr":{"state":"merged","number":9}},{"name":"nopr","path":"/n"}]}'
    run plan lib/land/plan.mjs "$payload"
    [ "$output" = $'g\t/g\t12\tpassing\tu12' ]
}

@test "ship plan still emits its exact TSV through the shared reader" {
    payload='{"repos":[{"name":"tools","path":"/tmp/tools","branch":"ship/demo","dirty":0,"untracked":0,"ahead":0,"has_remote":true,"upstream":true}]}'
    run plan lib/ship/plan.mjs "$payload" SHIP_INCLUDE_CLEAN_BRANCH=1
    [ "$output" = $'tools\t/tmp/tools\tship/demo\t0\t0\t1' ]
}

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
        | node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/repos.schema.json"
}

@test "validate-json + repos schema: accepts a minimal doc, rejects a missing field" {
    local v="$TOOLS_HOME/lib/tools/validate-json.mjs" s="$TOOLS_HOME/schemas/repos.schema.json"
    # one chained statement so each clause gates under bats' last-command errexit:
    # a minimal valid doc passes, and dropping a required key is actually caught.
    printf '%s' '{"ok":true,"roots":[],"count":0,"repos":[]}' | node "$v" "$s" \
        && ! printf '%s' '{"ok":true,"roots":[],"count":0}' | node "$v" "$s"
}
