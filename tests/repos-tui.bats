#!/usr/bin/env bats
# repos-tui.bats — the `repos tui` fleet explorer. The fixture builds a tiny
# hermetic CODE_HOME with real git metadata, including an upstream marked [gone],
# so the workflow signals are tested without network or real repos.

load helpers

repos_bin() { "$TOOLS_HOME/bin/repos" "$@"; }
tui() { node "$TOOLS_HOME/lib/repos/tui.mjs" "$@"; }

make_commit_ref() {
    local repo="$1" branch="$2" message="$3"
    (
        cd "$repo"
        git add .
        tree="$(git write-tree)"
        commit="$(printf '%s\n' "$message" | git -c commit.gpgsign=false commit-tree "$tree")"
        git update-ref "refs/heads/$branch" "$commit"
        git symbolic-ref HEAD "refs/heads/$branch"
        git reset --quiet
    )
}

setup_fleet() {
    export CODE_HOME="$BATS_TEST_TMPDIR/code"
    mkdir -p "$CODE_HOME/Assets" "$CODE_HOME/Projects"

    mkdir -p "$CODE_HOME/Assets/dirty-app"
    (
        cd "$CODE_HOME/Assets/dirty-app"
        git init -q
        git config user.name joeseverino
        git config user.email github@jseverino.com
        printf '{"scripts":{"test":"true"}}\n' > package.json
        printf 'clean\n' > README.md
        make_commit_ref "$PWD" main init
        printf 'dirty\n' > README.md
        printf 'new\n' > scratch.txt
    )

    mkdir -p "$CODE_HOME/Assets/merged-branch"
    (
        cd "$CODE_HOME/Assets/merged-branch"
        git init -q
        git config user.name joeseverino
        git config user.email github@jseverino.com
        printf 'merged\n' > README.md
        make_commit_ref "$PWD" feature/merged init
        git remote add origin git@example.com:demo/merged-branch.git
        git config branch.feature/merged.remote origin
        git config branch.feature/merged.merge refs/heads/deleted-on-github
    )

    mkdir -p "$CODE_HOME/Projects/local-tool"
    printf '{"name":"local-tool"}\n' > "$CODE_HOME/Projects/local-tool/package.json"
}

@test "repos json exposes gone upstream state for merged branches" {
    setup_fleet
    run repos_bin --json merged-branch
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
repo=json.load(sys.stdin)["repos"][0]
assert repo["upstream"] is True
assert repo["upstream_name"] == "origin/deleted-on-github"
assert repo["upstream_track"] == "[gone]"
assert repo["upstream_gone"] is True
'
}

@test "repos --unpushed includes branches whose upstream was deleted" {
    setup_fleet
    run repos_bin --unpushed --json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
names={r["name"] for r in json.load(sys.stdin)["repos"]}
assert "merged-branch" in names
'
}

@test "smoke: repos tui shows fleet counts, workflow tabs, and actions" {
    setup_fleet
    export REPOS_TUI_SMOKE=1
    run repos_bin tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"repos tui"* ]]
    [[ "$output" == *"Dirty"* ]]
    [[ "$output" == *"Resync"* ]]
    [[ "$output" == *"dirty-app"* ]]
    [[ "$output" == *"ship preview"* ]]
    [[ "$output" == *"ship apply"* ]]
}

@test "replay: resync view surfaces gone upstream cleanup command" {
    setup_fleet
    export REPOS_TUI_KEYS='right,right,right,tab'
    run repos_bin tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"Resync 1"* ]]
    [[ "$output" == *"merged-branch"* ]]
    [[ "$output" == *"gone"* ]]
    [[ "$output" == *"resync --dry-run 'merged-branch'"* ]]
}

@test "replay: copying an action produces a deterministic flash" {
    setup_fleet
    export REPOS_TUI_KEYS='tab,enter'
    run repos_bin tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"copied ship preview: ship 'dirty-app' --check --watch"* ]]
}

@test "replay: x shows the selected action that would run" {
    setup_fleet
    export REPOS_TUI_KEYS='tab,down,x'
    run repos_bin tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"would run ship apply: ship 'dirty-app' --check --watch --go"* ]]
}

@test "repos tui refuses without a terminal outside smoke/replay" {
    setup_fleet
    run repos_bin tui
    [ "$status" -eq 1 ]
    [[ "$output" == *"needs a terminal"* ]]
    [[ "$output" == *"repos --json"* ]]
}
