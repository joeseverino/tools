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

@test "git_commit_message defaults to a release-please-friendly subject" {
    repo="$BATS_TEST_TMPDIR/repo"
    mkdir -p "$repo"
    (
        cd "$repo"
        git init -q
        printf 'x\n' > README.md
        git add README.md
        source "$TOOLS_HOME/lib/git.sh"
        git_commit_message
    ) >"$BATS_TEST_TMPDIR/message"

    [ "$(cat "$BATS_TEST_TMPDIR/message")" = "chore: update README.md" ]
}

@test "git_conventional_subject accepts release-please-friendly subjects only" {
    run bash -c 'source "$TOOLS_HOME/lib/git.sh"; git_conventional_subject "feat: add dashboard"'
    [ "$status" -eq 0 ]

    run bash -c 'source "$TOOLS_HOME/lib/git.sh"; git_conventional_subject "Add dashboard"'
    [ "$status" -eq 1 ]
}

@test "ship --go rejects non-conventional PR titles before planning" {
    run "$TOOLS_HOME/bin/ship" tools --go -m "Add dashboard"
    [ "$status" -eq 2 ]
    [[ "$output" == *"PR title must be Conventional Commits"* ]]
}
