#!/usr/bin/env bats
# common.bats — regressions for the shared helpers in lib/common.sh.

load helpers

@test "die tolerates a single argument under set -u (no unbound \$2 crash)" {
    # bin/hq uses the one-arg form `die "<message>"` throughout; under set -u a
    # naive `msg "$RED" "$1" "$2"` expands an unset $2 and crashes.
    run bash -uc 'source "$TOOLS_HOME/lib/common.sh"; die "lone message"'
    [ "$status" -eq 1 ]
    [[ "$output" == *"error"* ]]
    [[ "$output" == *"lone message"* ]]
}

@test "die keeps the (label, body, code) convention for multi-arg calls" {
    run bash -uc 'source "$TOOLS_HOME/lib/common.sh"; die "usage" "bad args" 2'
    [ "$status" -eq 2 ]
    [[ "$output" == *"usage"* ]]
    [[ "$output" == *"bad args"* ]]
}
