#!/usr/bin/env bats
# land.bats — the merge beat of the workspace loop. The fixture builds repos on
# branches the hermetic gh stub (tests/fixtures/gh) reports as green / failing
# PRs, so land's read (repos --prs), green gate, --admin override, and the merge
# call are all tested without network or auth. gh merges are logged to
# $GH_MERGE_LOG instead of being issued.
#
# Like repos-tui.bats: Bats 1.13 only gates on a test's LAST command, so multi-
# part assertions are chained into one `&&` statement so each part gates.

load helpers

land_bin() { PATH="$TOOLS_HOME/bin:$PATH" "$TOOLS_HOME/bin/land" "$@"; }

setup_land_fleet() {
    export CODE_HOME="$BATS_TEST_TMPDIR/code"
    mkdir -p "$CODE_HOME/Assets"
    export GH_BIN="$BATS_TEST_DIRNAME/fixtures/gh"
    export GH_MERGE_LOG="$BATS_TEST_TMPDIR/merge.log"
    : > "$GH_MERGE_LOG"
    local spec name branch d
    for spec in green:ship/green red:ship/red; do
        name="${spec%%:*}"; branch="${spec#*:}"; d="$CODE_HOME/Assets/$name-app"
        mkdir -p "$d"
        (
            cd "$d"
            git init -q
            git config user.name joeseverino
            git config user.email github@jseverino.com
            printf 'x\n' > a
            git add .
            tree="$(git write-tree)"
            commit="$(printf 'init\n' | git -c commit.gpgsign=false commit-tree "$tree")"
            git update-ref "refs/heads/$branch" "$commit"
            git symbolic-ref HEAD "refs/heads/$branch"
            git reset --quiet
            git remote add origin "git@github.com:demo/$name-app.git"
        )
    done
}

@test "land describe is a remote_write+network Workspace verb" {
    run land_bin --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["effect"]=="remote_write", o["effect"]
assert o["network"] is True
assert o["group"]=="Workspace", o.get("group")
'
}

@test "land -h documents the green gate and --admin override" {
    run land_bin -h
    [ "$status" -eq 0 ]
    grep -qF "Usage: land" <<<"$output" \
      && grep -qF "Effect: remote_write" <<<"$output" \
      && grep -qF -- "--admin" <<<"$output"
}

@test "land dry-run previews green as mergeable and failing as skipped" {
    setup_land_fleet
    run land_bin
    [ "$status" -eq 0 ]
    grep -qF "dry run" <<<"$output" \
      && grep -qF "green-app  PR #12 (passing) → merge" <<<"$output" \
      && grep -qF "red-app    PR #13 (failing) — not green" <<<"$output"
    [ ! -s "$GH_MERGE_LOG" ]
}

@test "land <name> --go merges the green PR via git_merge_pr" {
    setup_land_fleet
    run land_bin green-app --go
    [ "$status" -eq 0 ]
    grep -qF "merged" <<<"$output" \
      && grep -qF "green-app: PR #12" <<<"$output"
    grep -qF "pr merge --squash --delete-branch" "$GH_MERGE_LOG"
}

@test "land refuses to merge a failing PR without --admin" {
    setup_land_fleet
    run land_bin red-app --go
    [ "$status" -eq 0 ]
    grep -qF "not green; skipped" <<<"$output"
    [ ! -s "$GH_MERGE_LOG" ]
}

@test "land --admin merges a failing PR and passes --admin to gh" {
    setup_land_fleet
    run land_bin red-app --go --admin
    [ "$status" -eq 0 ]
    grep -qF "merged" <<<"$output"
    grep -qF -- "--admin" "$GH_MERGE_LOG"
}

@test "land --go refuses a fleet without --all" {
    setup_land_fleet
    run land_bin --go
    [ "$status" -eq 2 ]
    grep -qF "open PRs" <<<"$output" \
      && grep -qF "pass --all" <<<"$output"
    [ ! -s "$GH_MERGE_LOG" ]
}

@test "land with no open PRs is a clean no-op" {
    export CODE_HOME="$BATS_TEST_TMPDIR/empty"
    mkdir -p "$CODE_HOME/Assets"
    export GH_BIN="$BATS_TEST_DIRNAME/fixtures/gh"
    run land_bin
    [ "$status" -eq 0 ]
    grep -qF "nothing to land" <<<"$output"
}
