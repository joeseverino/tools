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
        git remote add origin git@github.com:demo/dirty-app.git
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
    (
        cd "$CODE_HOME/Projects/local-tool"
        git init -q
        git config user.name joeseverino
        git config user.email github@jseverino.com
        printf '{"name":"local-tool"}\n' > package.json
        make_commit_ref "$PWD" main init
    )
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

@test "repos describe exposes tui as a structured command with the right effect" {
    run repos_bin --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["effect"] == "read"
tui={c["name"]: c for c in o["commands"]}["tui"]
assert tui["effect"] == "remote_write"
assert tui["network"] is True
assert tui["interactive"] is True
'
}

@test "repos tui -h shows the dashboard filters and effect" {
    run repos_bin tui -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: repos tui"* ]]
    [[ "$output" == *"Effect: remote_write · network · interactive"* ]]
    [[ "$output" == *"--dirty"* ]]
    [[ "$output" == *"--root DIR"* ]]
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

@test "repos json marks configured local-only repos as ok" {
    setup_fleet
    printf 'REPOS_LOCAL_OK=(local-tool)\n' > "$BATS_TEST_TMPDIR/repos.sh"
    export REPOS_CONFIG="$BATS_TEST_TMPDIR/repos.sh"
    run repos_bin --json local-tool
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
repo=json.load(sys.stdin)["repos"][0]
assert repo["has_remote"] is False
assert repo["local_ok"] is True
assert repo["needs_attention"] is False
'
    run repos_bin --unpushed --json local-tool
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
assert json.load(sys.stdin)["repos"] == []
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
    [[ "$output" == *"s shell"* ]]
    [[ "$output" == *"o GitHub"* ]]
    [[ "$output" != *"1 all"* ]]
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

@test "replay: s shells into the selected repo" {
    setup_fleet
    export REPOS_TUI_KEYS='s'
    run repos_bin tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"would run shell: cd "* ]]
    [[ "$output" == *"dirty-app"* ]]
}

@test "replay: o opens the selected repo on GitHub in Safari" {
    setup_fleet
    export REPOS_TUI_KEYS='o'
    run repos_bin tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"would run open GitHub: open -a Safari 'https://github.com/demo/dirty-app'"* ]]
}

@test "repos tui refuses without a terminal outside smoke/replay" {
    setup_fleet
    run repos_bin tui
    [ "$status" -eq 1 ]
    [[ "$output" == *"needs a terminal"* ]]
    [[ "$output" == *"repos --json"* ]]
}
