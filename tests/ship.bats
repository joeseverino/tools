#!/usr/bin/env bats
# ship.bats — focused coverage for the fleet ship planner.

load helpers

@test "ship planner can include a clean pushed feature branch for PR creation" {
    payload='{"repos":[{"name":"tools","path":"/tmp/tools","branch":"ship/demo","dirty":0,"untracked":0,"ahead":0,"has_remote":true,"upstream":true}]}'

    run bash -c 'printf "%s" "$1" | SHIP_INCLUDE_CLEAN_BRANCH=1 node "$TOOLS_HOME/lib/ship/plan.mjs"' _ "$payload"
    [ "$status" -eq 0 ]
    [[ "$output" == $'tools\t/tmp/tools\tship/demo\t0\t0\t1' ]]
}

@test "ship planner keeps clean pushed feature branches out of the default fleet plan" {
    payload='{"repos":[{"name":"tools","path":"/tmp/tools","branch":"ship/demo","dirty":0,"untracked":0,"ahead":0,"has_remote":true,"upstream":true}]}'

    run bash -c 'printf "%s" "$1" | node "$TOOLS_HOME/lib/ship/plan.mjs"' _ "$payload"
    [ "$status" -eq 0 ]
    [ "$output" = "" ]
}
