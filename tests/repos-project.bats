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
