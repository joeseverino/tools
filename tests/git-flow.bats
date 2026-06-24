#!/usr/bin/env bats
# git-flow.bats — the branch-safety engine in lib/git.sh: the one ladder
# (git_branch_state) that decides whether a branch is a safe home for new work,
# plus the recovery primitives (cut-fresh, rebranch) and the squash-merge
# pruner. Every repo is a real git repo with a real bare "origin", so ancestry,
# behind/ahead, and stash carry are exercised for real. gh is the hermetic stub.

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
    source "$TOOLS_HOME/lib/git.sh"
}

# Advance origin/main by one commit from a second clone, then fetch — so the
# current branch is genuinely behind the base it forked from. Forces main from
# origin so it never depends on the clone's default-branch checkout.
advance_origin() {
    local c="$BATS_TEST_TMPDIR/other"
    git clone -q "$origin" "$c" 2>/dev/null
    git -C "$c" config user.email o@o.io
    git -C "$c" config user.name other
    git -C "$c" checkout -q -B main origin/main
    printf 'moved\n' > "$c/b.txt"
    git -C "$c" add b.txt
    git -C "$c" commit -q -m "feat: move main"
    git -C "$c" push -q origin main
    git fetch -q origin
}

@test "git_branch_state: on main is trunk" {
    setup_flow
    [ "$(git_branch_state main)" = "trunk" ]
}

@test "git_branch_state: a branch with no unique commits is a zombie" {
    setup_flow
    git checkout -q -b feat/empty origin/main
    [ "$(git_branch_state main)" = "zombie" ]
}

@test "git_branch_state: an up-to-date feature branch with commits is current" {
    setup_flow
    git checkout -q -b feat/work origin/main
    printf 'x\n' > c.txt; git add c.txt; git commit -q -m "feat: c"
    [ "$(git_branch_state main)" = "current" ]
}

@test "git_branch_state: committed work behind base, no PR, is stale" {
    setup_flow
    git checkout -q -b feat/old origin/main
    printf 'x\n' > c.txt; git add c.txt; git commit -q -m "feat: c"
    advance_origin
    [ "$(git_branch_state main)" = "stale" ]
}

@test "git_branch_state: a branch with an open PR is pr, even when behind" {
    setup_flow
    git checkout -q -b feat/haspr origin/main
    printf 'x\n' > c.txt; git add c.txt; git commit -q -m "feat: c"
    advance_origin
    [ "$(git_branch_state main 1)" = "pr" ]
}

@test "git_target_branch: returns GIT_TARGET_STALE on a stale branch (no silent recut)" {
    setup_flow
    git checkout -q -b feat/old origin/main
    printf 'x\n' > c.txt; git add c.txt; git commit -q -m "feat: c"
    advance_origin
    run git_target_branch main ship
    [ "$status" -eq 3 ]
    # still on the original branch — nothing was recut behind our back
    [ "$(git symbolic-ref --short HEAD)" = "feat/old" ]
}

@test "git_target_branch: on main cuts a fresh branch carrying the working tree" {
    setup_flow
    printf 'dirty\n' > d.txt          # uncommitted work on main
    run git_target_branch main ship
    [ "$status" -eq 0 ]
    # Exact format, not just a prefix: the echoed value must be ONLY the branch
    # name — no git "Dropped refs/stash" chatter leaking in (a git-version-
    # sensitive stdout leak that passes locally but failed on CI).
    [[ "$output" =~ ^ship/[0-9]{8}-[0-9]{6}$ ]]
    [ "$(git symbolic-ref --short HEAD)" != "main" ]
    [ -f d.txt ]                       # the edit rode onto the fresh branch
}

@test "git_rebranch: replays commits onto a fresh branch off current base, dropping merged" {
    setup_flow
    git checkout -q -b feat/old origin/main
    printf 'mine\n' > mine.txt; git add mine.txt; git commit -q -m "feat: mine"
    advance_origin
    run git_rebranch main ship
    [ "$status" -eq 0 ]
    [[ "$output" == ship/* ]]
    git checkout -q "$output"
    [ -f mine.txt ]                    # my commit was carried
    [ -f b.txt ]                       # ...onto current origin/main (has the moved file)
    [ "$(git rev-list --count HEAD)" -ge 3 ]
}

@test "git_sync_clean: prunes a squash-merged branch whose commits look diverged" {
    setup_flow
    # A branch whose PR merged (stub: *wasmerged*), left behind as a "gone"
    # local branch with a commit not in main (the squash rewrote it).
    git checkout -q -b feat/wasmerged origin/main
    printf 'sq\n' > sq.txt; git add sq.txt; git commit -q -m "feat: sq"
    git push -q -u origin feat/wasmerged
    # Simulate the post-squash-merge state: remote branch deleted upstream.
    git push -q origin --delete feat/wasmerged
    git checkout -q main
    git_sync_clean main
    run git show-ref --verify --quiet refs/heads/feat/wasmerged
    [ "$status" -ne 0 ]                # the merged branch was pruned
}

@test "git_sync_clean: keeps a genuinely diverged branch with no merged PR" {
    setup_flow
    git checkout -q -b feat/diverged origin/main
    printf 'd\n' > d.txt; git add d.txt; git commit -q -m "feat: d"
    git push -q -u origin feat/diverged
    git push -q origin --delete feat/diverged   # gone upstream, but PR not merged
    git checkout -q main
    git_sync_clean main
    run git show-ref --verify --quiet refs/heads/feat/diverged
    [ "$status" -eq 0 ]               # unique work, no merged PR -> kept
}

@test "git_sync_clean: steps off and prunes a squash-merged CURRENT branch" {
    setup_flow
    # On a branch whose PR merged (stub: *wasmerged*) and whose remote was
    # deleted, but with a unique commit (the squash rewrote it). resync must step
    # back to main and prune it, not strand us on the gone branch (the jseverino
    # "needs resync / gone after resync" bug — same squash case as the pruner).
    git checkout -q -b feat/wasmerged origin/main
    printf 'sq\n' > sq.txt; git add sq.txt; git commit -q -m "feat: sq"
    git push -q -u origin feat/wasmerged
    git push -q origin --delete feat/wasmerged
    git_sync_clean main                              # still ON feat/wasmerged
    # Assertions chained (&&): bats 1.13 gates only a test's LAST command, so an
    # unchained earlier check would be silently skipped locally and only fail CI.
    [ "$(git symbolic-ref --short HEAD)" = "main" ] \
        && ! git show-ref --verify --quiet refs/heads/feat/wasmerged
}

@test "git_merged_branches: lists fully-merged branches, never base/current/unpushed" {
    setup_flow
    # feat/wasmerged is pushed (its upstream is origin/feat/wasmerged, not ahead),
    # so it is genuinely reapable; feat/keepme is not merged (name not *wasmerged*).
    git checkout -q -b feat/wasmerged origin/main
    printf 'x\n' > x.txt; git add x.txt; git commit -q -m "feat: x"
    git push -q -u origin feat/wasmerged
    git checkout -q -b feat/keepme origin/main
    printf 'k\n' > k.txt; git add k.txt; git commit -q -m "feat: k"
    git push -q -u origin feat/keepme
    git checkout -q main
    run git_merged_branches main
    [[ "$output" == *"feat/wasmerged"* ]] \
        && [[ "$output" != *"feat/keepme"* ]] \
        && [[ "$output" != *"main"* ]]
}

@test "git_merged_branches: protects a merged branch with commits ahead of its upstream" {
    setup_flow
    git checkout -q -b feat/wasmerged origin/main
    printf 'x\n' > x.txt; git add x.txt; git commit -q -m "feat: x"
    git push -q -u origin feat/wasmerged
    printf 'more\n' > more.txt; git add more.txt; git commit -q -m "feat: more"  # ahead 1, unpushed
    git checkout -q main
    run git_merged_branches main
    [ -z "$output" ]                                  # unpushed work -> never reaped
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

@test "git_staged_icloud_conflicts matches '<stem> <n>[.ext]' duplicates only" {
    setup_flow
    : > "a 2.mjs"; : > "b.mjs"; : > "c2.mjs"; : > "d 3"
    git add -A
    run git_staged_icloud_conflicts
    # one chained assertion so each clause gates under bats' last-command errexit
    grep -qx 'a 2.mjs' <<<"$output" \
        && grep -qx 'd 3' <<<"$output" \
        && ! grep -q 'b.mjs' <<<"$output" \
        && ! grep -q 'c2.mjs' <<<"$output"
}

@test "git_commit drops iCloud-conflict duplicates but keeps real files" {
    setup_flow
    printf 'real\n' > real.mjs
    printf 'dupe\n' > "real 2.mjs"
    printf 'dupe\n' > "notes 3.bats"
    git_commit "feat: add real.mjs"
    tree="$(git ls-tree -r --name-only HEAD)"
    # committed real file present; both conflicts excluded yet left on disk
    grep -qx 'real.mjs' <<<"$tree" \
        && ! grep -q ' 2\.mjs' <<<"$tree" \
        && ! grep -q ' 3\.bats' <<<"$tree" \
        && [ -f 'real 2.mjs' ] && [ -f 'notes 3.bats' ]
}
