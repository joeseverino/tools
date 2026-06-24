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

@test "path_without removes every instance of a directory from a PATH string" {
    run bash -uc 'source "$TOOLS_HOME/lib/common.sh"; path_without /a "/a:/b:/a:/c"'
    [ "$status" -eq 0 ]
    [ "$output" = "/b:/c" ]
}

@test "path_without defaults to \$PATH and drops empty segments" {
    run bash -uc 'source "$TOOLS_HOME/lib/common.sh"; PATH="/x::/y"; path_without /nope'
    [ "$status" -eq 0 ]
    [ "$output" = "/x:/y" ]
}

@test "ci_shell_env puts the repo bin first, strips the install dir, idempotently" {
    run bash -uc '
        source "$TOOLS_HOME/lib/common.sh"
        export TOOLS_HOME=/repo TOOLS_INSTALL_DIR=/inst
        PATH="/inst:/usr/bin:/repo/bin"
        ci_shell_env; first="$PATH"
        ci_shell_env; second="$PATH"
        printf "%s\n%s\n" "$first" "$second"
    '
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "/repo/bin:/usr/bin" ]
    [ "${lines[1]}" = "/repo/bin:/usr/bin" ]
}

@test "ci_shell_env isolates git from the operator's global and system config" {
    run bash -uc '
        source "$TOOLS_HOME/lib/common.sh"
        export TOOLS_HOME=/repo
        ci_shell_env
        printf "%s|%s|%s\n" "$GIT_CONFIG_GLOBAL" "$GIT_CONFIG_SYSTEM" "$GIT_CONFIG_NOSYSTEM"
    '
    [ "$status" -eq 0 ]
    [ "$output" = "/dev/null|/dev/null|1" ]
}
