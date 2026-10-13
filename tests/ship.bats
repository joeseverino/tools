#!/usr/bin/env bats
# ship.bats — the ship driver end to end; the planner and git mechanics are unit-tested in tests/unit.

load helpers

@test "ship --go rejects non-conventional PR titles before planning" {
    run "$TOOLS_HOME/bin/ship" tools --go -m "Add dashboard"
    [ "$status" -eq 2 ]
    [[ "$output" == *"PR title must be Conventional Commits"* ]]
}

# A push failure must never report "shipped" — the 2026-07-04 silent-skip bug:
# every skip path exited the subshell 0 and the tally counted it as shipped.
@test "ship --go reports a failed push as skipped, not shipped" {
    local home="$BATS_TEST_TMPDIR/code"
    mkdir -p "$home/Assets/workrepo"
    cd "$home/Assets/workrepo"
    git init -q -b main .
    git config user.email t@t.io
    git config user.name tester
    printf 'one\n' > a.txt
    git add a.txt
    git commit -q -m "feat: one"
    # origin exists in config but is unreachable — fetch is soft, push must fail
    git remote add origin "$BATS_TEST_TMPDIR/definitely-missing.git"
    git checkout -q -b feat/work
    printf 'two\n' > b.txt
    CODE_HOME="$home" run "$TOOLS_HOME/bin/ship" workrepo --go -m "feat: two"
    [ "$status" -eq 0 ] \
        && grep -qF "push failed" <<<"$output" \
        && grep -qF "skipped    1 repo(s)" <<<"$output" \
        && grep -qF "shipped    0 repo(s)" <<<"$output"
}
