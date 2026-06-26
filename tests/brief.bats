#!/usr/bin/env bats
# brief.bats — the workspace aggregator. Asserts the cohesion contract: brief
# reads PR/CI state from `repos --prs` (the one PR owner — brief runs no gh of its
# own), and its "next" block names the loop in order, including `land` for green
# PRs. The vault MCP is shadowed by tests/fixtures/severino-vault-mcp (its default
# returns {"ok":true}), so vault facts degrade cleanly and the repo/PR assertions
# are deterministic with no network.
#
# Bats 1.13 gates only on a test's LAST command — multi-part checks are chained.

load helpers

brief_bin() { PATH="$BATS_TEST_DIRNAME/fixtures:$TOOLS_HOME/bin:$PATH" "$TOOLS_HOME/bin/brief" "$@"; }

mkref() {
    ( cd "$1"; git add .; tree="$(git write-tree)"
      commit="$(printf '%s\n' "$3" | git -c commit.gpgsign=false commit-tree "$tree")"
      git update-ref "refs/heads/$2" "$commit"; git symbolic-ref HEAD "refs/heads/$2"; git reset -q )
}

setup_brief_fleet() {
    export CODE_HOME="$BATS_TEST_TMPDIR/code"
    mkdir -p "$CODE_HOME/Assets"
    export GH_BIN="$BATS_TEST_DIRNAME/fixtures/gh"
    mkdir -p "$CODE_HOME/Assets/green-app"
    (
        cd "$CODE_HOME/Assets/green-app"
        git init -q; git config user.name joeseverino; git config user.email github@jseverino.com
        printf 'x\n' > a
    ); mkref "$CODE_HOME/Assets/green-app" ship/green init
    ( cd "$CODE_HOME/Assets/green-app"; git remote add origin git@github.com:demo/green-app.git )
    mkdir -p "$CODE_HOME/Assets/dirty-app"
    (
        cd "$CODE_HOME/Assets/dirty-app"
        git init -q; git config user.name joeseverino; git config user.email github@jseverino.com
        printf 'x\n' > a
    ); mkref "$CODE_HOME/Assets/dirty-app" main init
    ( cd "$CODE_HOME/Assets/dirty-app"; git remote add origin git@github.com:demo/dirty-app.git; printf 'y\n' > a )
}

@test "brief describe is a read+network aggregator with --prs" {
    run brief_bin --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["effect"]=="read", o["effect"]
assert o["network"] is True
names={opt["name"] for opt in o.get("global_options",[])}
assert "--prs" in names, names
'
}

@test "brief --prs reads PR/CI state from repos (one owner, with review)" {
    setup_brief_fleet
    run brief_bin --prs --json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
d=json.load(sys.stdin)
pr={p["repo"]: p for p in d.get("prs",[])}
assert "green-app" in pr, d.get("prs")
assert pr["green-app"]["ci"]=="passing", pr
assert pr["green-app"]["review"]=="approved", pr
'
}

@test "brief --prs human briefing lists the open PR with its CI state" {
    setup_brief_fleet
    run brief_bin --prs
    [ "$status" -eq 0 ]
    grep -qF "open PRs" <<<"$output" \
      && grep -qF "green-app" <<<"$output" \
      && grep -qF "passing" <<<"$output"
}

@test "brief --prs next block names land for a green PR, in loop order" {
    setup_brief_fleet
    run brief_bin --prs
    [ "$status" -eq 0 ]
    grep -qF "land green-app --go" <<<"$output"
    # ship appears before land appears before the explore hint (loop order).
    [ "$(grep -nE 'ship|land' <<<"$output" | grep -m1 ship | cut -d: -f1)" \
        -lt "$(grep -nF 'land green-app' <<<"$output" | cut -d: -f1)" ]
}

@test "render: a stale branch_state surfaces as a rebranch row (consumes the owner)" {
    payload='{"repos":{"repos":[{"name":"old-app","pm":"npm","branch_state":"stale"}]}}'
    # json digest carries the stale repo
    run bash -c 'printf "%s" "$1" | node "$TOOLS_HOME/lib/brief/render.mjs" json 1' _ "$payload"
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["repos"]["stale"]==["old-app"], d["repos"]'
    # human briefing names the recovery verb
    run bash -c 'printf "%s" "$1" | node "$TOOLS_HOME/lib/brief/render.mjs" human 1' _ "$payload"
    [ "$status" -eq 0 ]
    grep -qF "ship old-app --rebranch --go" <<<"$output"
}

@test "brief without --prs shows no PR section and no land verb" {
    setup_brief_fleet
    run brief_bin
    [ "$status" -eq 0 ]
    ! grep -qF "open PRs" <<<"$output" && ! grep -qF "land " <<<"$output"
}

@test "daily render: callouts from a brief digest, empty sections dropped" {
    digest='{"repos":{"ship":["tools"],"resync":[],"stale":[],"dirty":["tools"]},"vault":{"docs_to_review":2,"docs_to_review_top":["doc-a","doc-b"],"inbox":1,"recent_changes":3},"backlog":{"open":5,"stale":0,"stale_slugs":[]},"writeups":{"drafts":["wp-x"]}}'
    run bash -c 'printf "%s" "$1" | node "$TOOLS_HOME/lib/brief/daily.mjs" 2026-06-25' _ "$digest"
    [ "$status" -eq 0 ]
    # one chained assertion (bats 1.13 gates only the last command)
    grep -qF '> [!note] 2026-06-25' <<<"$output" \
        && grep -qF 'ship tools --check --watch --go' <<<"$output" \
        && grep -qF '[[doc-a]]' <<<"$output" \
        && grep -qF '[!info]+ Docs to review (2)' <<<"$output" \
        && ! grep -q 'Stale backlog' <<<"$output"
}
