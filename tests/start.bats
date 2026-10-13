#!/usr/bin/env bats
# start.bats — the opening beat of the workspace loop: a fresh branch off
# origin/<base>, carrying uncommitted edits. Repos are real git repos with a
# real bare origin; gh is the hermetic stub.

load helpers

# A repo wired to a bare origin, sitting on main with one pushed commit. The
# default branch is forced to `main` everywhere (`-b main`), never inherited from
# the host's init.defaultBranch — that leaks: a dev box set to `main` and a CI
# Linux runner defaulting to `master` would otherwise behave differently (the
# clone checks out an unborn branch and the push isn't a fast-forward). Global
# git config (hooks, aliases, defaultBranch) is already isolated by ci_shell_env
# via the helpers, so no per-repo hooks override is needed.
setup_flow() {
    export GH_BIN="$BATS_TEST_DIRNAME/fixtures/gh"
    origin="$BATS_TEST_TMPDIR/origin.git"
    work="$BATS_TEST_TMPDIR/work"
    git init -q --bare -b main "$origin"
    git init -q -b main "$work"
    cd "$work"
    git config user.email t@t.io
    git config user.name tester
    git remote add origin "$origin"
    printf 'one\n' > a.txt
    git add a.txt
    git commit -q -m "feat: one"
    git push -q -u origin main
    git remote set-head origin main 2>/dev/null || true
}

@test "start: cuts a slug branch off origin/main carrying uncommitted edits" {
    setup_flow
    printf 'edit\n' > new.txt          # uncommitted work started on main
    run "$TOOLS_HOME/bin/start" "fix dns rewrites"
    [ "$status" -eq 0 ]
    [ "$(git symbolic-ref --short HEAD)" = "fix-dns-rewrites" ]
    [ -f new.txt ]                     # the edit rode onto the fresh branch
    [[ "$output" == *"off origin/main"* ]]
}

@test "start: with no slug generates a timestamped work branch" {
    setup_flow
    run "$TOOLS_HOME/bin/start"
    [ "$status" -eq 0 ]
    [[ "$(git symbolic-ref --short HEAD)" == work/* ]]
}
