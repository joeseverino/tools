# shellcheck shell=bash
# git.sh — the one owner of git/PR mechanics for the toolchain.
#
# The single source of truth for "how we commit / push / open-PR / land / sync a
# repo." `ship` (fleet) is built on it; the per-repo commands (site publish/land,
# hq ship, vault sync) ride the same primitives as they migrate, so the mechanics
# are written and bulletproofed once, not per tool. Same shape as lib/drift.sh.
#
# Each function operates on the current working directory — callers cd into the
# repo first. Functions echo their primary result (branch name, PR URL, body) and
# return 0 on success, non-zero on failure, so they compose cleanly under set -e.
#
# All GitHub calls go through "${GH_BIN:-gh}" so the test suite can shadow gh with
# a hermetic stub (no network, no auth) — the same indirection bin/repos and
# bin/land use. Never call bare `gh` here; add a call site through GH_BIN.

# Default branch name (origin/HEAD), falling back to main.
git_default_branch() {
    local b
    b="$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)"
    printf '%s' "${b:-main}"
}

# Commits on HEAD not yet in origin/<base> (0 when merged or even).
git_unique_commits() {
    git rev-list --count "origin/${1}..HEAD" 2>/dev/null || echo 0
}

# Commits on origin/<base> not yet on HEAD (>0 means the branch is behind the
# base it forked from — out of date).
git_behind_commits() {
    git rev-list --count "HEAD..origin/${1}" 2>/dev/null || echo 0
}

# True when the working tree has any change at all (unstaged, staged, or a new
# untracked-but-not-ignored file) — i.e. there is something a fresh checkout
# would need to carry.
git_worktree_dirty() {
    ! git diff --quiet \
        || ! git diff --cached --quiet \
        || [[ -n "$(git ls-files --others --exclude-standard)" ]]
}

# True when an OPEN PR exists for branch <1> against base <2>. The "am I already
# iterating on a published PR" signal — such a branch is always kept.
git_branch_has_open_pr() {
    [[ -n "$("${GH_BIN:-gh}" pr list --head "$1" --base "$2" --state open \
                --json number -q '.[0].number' 2>/dev/null || true)" ]]
}

# True when branch <1> has a MERGED PR on GitHub. Used by the pruner to retire a
# squash-merged branch whose local commits are NOT ancestors of <base> (the
# squash rewrote them) and so look "diverged" to plain ancestry checks.
git_branch_pr_merged() {
    [[ -n "$("${GH_BIN:-gh}" pr list --head "$1" --state merged \
                --json number -q '.[0].number' 2>/dev/null || true)" ]]
}

# A timestamped, collision-free branch name under <prefix> (default "ship").
git_fresh_name() { printf '%s/%s' "${1:-ship}" "$(date +%Y%m%d-%H%M%S)"; }

# Cut <branch> off origin/<base>, carrying any uncommitted work in the tree.
# Stash-safe so the checkout still succeeds when the tree touches files that
# differ in origin/<base>. Echoes the branch name; returns 1 if it can't be
# created. The one place a fresh branch is born — start, ship, and rebranch all
# ride it, so "how we start clean off the base" lives once.
git_cut_fresh() {
    local base="$1" branch="$2" stashed=0
    # All git chatter is silenced: this function's stdout is the branch name and
    # nothing else. `git stash pop` prints "Dropped refs/stash@{0}" on some git
    # builds even with -q, which would otherwise pollute the echoed name (local
    # git may suppress it while CI's does not — a real local-vs-CI divergence).
    if git_worktree_dirty; then
        git stash push -q -u -m "carry work onto $branch" >/dev/null 2>&1 && stashed=1
    fi
    if ! git checkout -q -b "$branch" "origin/$base" >/dev/null 2>&1; then
        (( stashed )) && git stash pop -q >/dev/null 2>&1 || true
        return 1
    fi
    (( stashed )) && { git stash pop -q >/dev/null 2>&1 || true; }
    printf '%s' "$branch"
}

# Classify the current branch as a home for new work, vs origin/<base>. Echoes
# exactly one token. THE single source of truth for "is this branch safe to
# commit onto" — ship (the write-time gate), repos --json, and the repos TUI
# queue all read this one ladder rather than re-deriving it.
#
#   trunk    main/master/detached HEAD — never commit here; cut a fresh branch
#   zombie   no unique commits vs base (merged, or a left-over after merge+delete)
#   pr       has an open PR — you are iterating on your own published branch
#   current  in-progress feature branch, up to date with base — keep working
#   stale    unique commits, no PR, behind base: forked from an old base and
#            carrying committed work that may already be merged (the trap that
#            re-introduces merged commits as conflicts)
#
# The pr check costs one `gh` call; pass want_pr=0 (second arg) to skip it where
# PR state is unknown/unwanted (the fast local tier), which collapses pr→stale.
git_branch_state() {
    local base="$1" want_pr="${2:-1}" cur
    cur="$(git symbolic-ref --short -q HEAD 2>/dev/null || echo HEAD)"
    [[ "$cur" == "main" || "$cur" == "master" || "$cur" == "HEAD" ]] && { printf 'trunk';  return; }
    [[ "$(git_unique_commits "$base")" == "0" ]]                      && { printf 'zombie'; return; }
    (( want_pr )) && git_branch_has_open_pr "$cur" "$base"            && { printf 'pr';     return; }
    [[ "$(git_behind_commits "$base")" == "0" ]]                      && { printf 'current'; return; }
    printf 'stale'
}

# Return codes for git_target_branch (a small contract so callers can react).
# Plain (not readonly) so re-sourcing lib/git.sh never errors.
GIT_TARGET_OK=0          # HEAD is (now) a safe home — proceed
GIT_TARGET_FAIL=1        # could not create a fresh branch
GIT_TARGET_STALE=3       # stale branch carries committed work — stop

# Resolve the branch to work on, off the git_branch_state ladder. Echoes the
# branch name (when usable) and returns a GIT_TARGET_* code. The whole point:
# neither you nor an agent should ever have to remember to branch before
# starting — every ship, this decides whether the current branch is a safe home
# and otherwise starts clean off the current base. A `stale` branch is NOT
# silently recut (that would strand or re-inherit committed work); it returns
# GIT_TARGET_STALE so the caller stops and guides (or runs git_rebranch).
git_target_branch() {
    local base="$1" prefix="${2:-ship}"
    case "$(git_branch_state "$base")" in
        trunk|zombie) git_cut_fresh "$base" "$(git_fresh_name "$prefix")" || return "$GIT_TARGET_FAIL"; return "$GIT_TARGET_OK" ;;
        pr|current)   printf '%s' "$(git symbolic-ref --short -q HEAD 2>/dev/null || echo HEAD)"; return "$GIT_TARGET_OK" ;;
        stale)        return "$GIT_TARGET_STALE" ;;
    esac
}

# Recover from a stale branch: cut a fresh branch off current origin/<base> and
# replay the current branch's commits onto it, dropping any that are already
# merged upstream (they cherry-pick empty). The original branch is left
# untouched, so nothing is ever lost. Echoes the new branch name on success;
# returns 1 (restoring the original branch, tree intact) when a replayed commit
# conflicts with already-merged work and needs a human.
git_rebranch() {
    local base="$1" prefix="${2:-ship}" cur fresh fork stashed=0
    cur="$(git symbolic-ref --short -q HEAD 2>/dev/null || echo HEAD)"
    fork="$(git merge-base "$cur" "origin/$base" 2>/dev/null || true)"
    [[ -n "$fork" ]] || return 1
    fresh="$(git_fresh_name "$prefix")"
    # As in git_cut_fresh: every git command is silenced so stdout is only the
    # branch name — no stash "Dropped" line can leak into the echoed value.
    if git_worktree_dirty; then
        git stash push -q -u -m "ship: carry work onto $fresh" >/dev/null 2>&1 && stashed=1
    fi
    if ! git checkout -q -b "$fresh" "origin/$base" >/dev/null 2>&1; then
        (( stashed )) && git stash pop -q >/dev/null 2>&1 || true
        return 1
    fi
    if git cherry-pick --empty=drop "$fork..$cur" >/dev/null 2>&1; then
        (( stashed )) && { git stash pop -q >/dev/null 2>&1 || true; }
        printf '%s' "$fresh"; return 0
    fi
    git cherry-pick --abort >/dev/null 2>&1 || true
    git checkout -q "$cur" >/dev/null 2>&1 || true
    git branch -qD "$fresh" >/dev/null 2>&1 || true
    (( stashed )) && git stash pop -q >/dev/null 2>&1 || true
    return 1
}

# A clean default commit message from the staged top-level paths.
git_commit_message() {
    local dirs
    dirs="$(git diff --cached --name-only 2>/dev/null | awk -F/ '{print $1}' | sort -u | head -4 | paste -sd, - || true)"
    printf 'chore: update %s' "${dirs:-working tree}"
}

# True when a commit/PR title follows the Conventional Commits shape that
# release-please expects to parse cleanly.
git_conventional_subject() {
    local re='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:[[:space:]].+'
    [[ "$1" =~ $re ]]
}

# Stage and commit. With trailing paths, stages only those; else everything.
# Empty message -> derived from the staged paths. Returns 1 (no error) when
# there is nothing to commit, so callers can `git_commit "$m" || true`.
git_commit() {
    local msg="$1"; shift
    if (( $# )); then git add -- "$@"; else git add -A; fi
    git diff --cached --quiet && return 1
    [[ -n "$msg" ]] || msg="$(git_commit_message)"
    git commit -q -m "$msg"
}

# Push the current branch, setting upstream.
git_push_current() {
    git push -q -u origin HEAD
}

# Bidirectional single-repo sync (vault style): rebase-pull then push.
git_pull_push() {
    git pull -q --rebase && git push -q
}

# Markdown PR body: new/modified/removed files + shortstat vs origin/<base>.
git_pr_body_summary() {
    local base="$1" ns new mod rem stat
    ns="$(git diff --name-status "origin/${base}...HEAD" 2>/dev/null || true)"
    new="$(awk '/^A/{print "`"$2"`"}' <<<"$ns" | paste -sd, - || true)"
    mod="$(awk '/^M/{print "`"$2"`"}' <<<"$ns" | paste -sd, - || true)"
    rem="$(awk '/^D/{print "`"$2"`"}' <<<"$ns" | paste -sd, - || true)"
    stat="$(git diff --shortstat "origin/${base}...HEAD" 2>/dev/null | sed 's/^ *//' || true)"
    echo "## Changes"
    [[ -n "$new" ]] && echo "**New:** $new"
    [[ -n "$mod" ]] && echo "**Modified:** $mod"
    [[ -n "$rem" ]] && echo "**Removed:** $rem"
    [[ -n "$stat" ]] && { echo; echo "_${stat}_"; }
    return 0
}

# Open a PR for the current branch against <base>, or update + return the
# existing one. Echoes the PR URL. On an existing PR it syncs the title to
# <title> (so the PR title keeps tracking the conventional commit subject that
# release-please reads) and rewrites the body only when <update_body> is 1 — a
# curated description is never clobbered by a default auto-summary. On create,
# title+body are used (gh --fill when both empty).
git_open_or_update_pr() {
    local base="$1" title="${2:-}" body="${3:-}" update_body="${4:-0}" head url
    head="$(git symbolic-ref --short -q HEAD 2>/dev/null || true)"
    url="$("${GH_BIN:-gh}" pr list --head "$head" --base "$base" --json url -q '.[0].url' 2>/dev/null || true)"
    if [[ -n "$url" ]]; then
        local args=()
        [[ -n "$title" ]] && args+=(--title "$title")
        (( update_body )) && [[ -n "$body" ]] && args+=(--body "$body")
        (( ${#args[@]} )) && { "${GH_BIN:-gh}" pr edit "$url" "${args[@]}" >/dev/null 2>&1 || true; }
        printf '%s' "$url"; return 0
    fi
    if [[ -n "$title" ]]; then
        "${GH_BIN:-gh}" pr create --base "$base" --title "$title" --body "$body" >/dev/null 2>&1 || return 1
    else
        "${GH_BIN:-gh}" pr create --base "$base" --fill >/dev/null 2>&1 || return 1
    fi
    "${GH_BIN:-gh}" pr view --json url -q .url 2>/dev/null || true
}

# Merge the current branch's PR and delete its remote branch. <strategy> is one of
# --squash (default) | --merge | --rebase; <admin>=1 adds --admin to bypass branch
# protection / required checks. Returns gh's exit status. The single merge
# mechanic — git_land (require-green policy) and bin/land (explicit policy) both
# ride this so "how we merge a PR" lives in exactly one place.
git_merge_pr() {
    local strategy="${1:---squash}" admin="${2:-0}" args
    args=(pr merge "$strategy" --delete-branch)
    (( admin )) && args+=(--admin)
    "${GH_BIN:-gh}" "${args[@]}"
}

# Land the current branch's PR: require green checks, then squash-merge + delete.
# Returns 2 when checks are not green, 1 on merge failure.
git_land() {
    "${GH_BIN:-gh}" pr checks >/dev/null 2>&1 || return 2
    git_merge_pr --squash 0
}

# True when local branch <1>'s upstream is gone (its remote branch was deleted,
# the signal a PR was merged + the branch auto-deleted on GitHub).
git_branch_gone() {
    [[ "$(git for-each-ref --format='%(upstream:track)' "refs/heads/$1" 2>/dev/null)" == *'[gone]'* ]]
}

# Bring the repo to a clean state: fetch --prune, fast-forward <base> when on it
# and behind, and delete local branches whose upstream was merged and deleted
# (never deletes a branch that still has unique commits — no lost work). If the
# CURRENT branch is itself merged + gone with nothing unique on it, step back
# onto <base> first so it can be pruned — the "merged the PR on GitHub with
# auto-delete, came back to the terminal still on that branch" case. A dirty
# working tree blocks the step-back/ff (git refuses), so the caller skips dirty
# repos. Returns 1 only on fetch failure.
git_sync_clean() {
    local base="${1:-}" cur b
    [[ -n "$base" ]] || base="$(git_default_branch)"
    git fetch -q origin --prune || return 1
    cur="$(git symbolic-ref --short -q HEAD 2>/dev/null || true)"

    if [[ -n "$cur" && "$cur" != "$base" ]] \
       && git_branch_gone "$cur" \
       && [[ "$(git_unique_commits "$base")" == "0" ]]; then
        git checkout -q "$base" 2>/dev/null && cur="$base"
    fi

    if [[ "$cur" == "$base" ]]; then
        git merge -q --ff-only "origin/$base" 2>/dev/null || true
    fi
    while read -r b; do
        [[ -n "$b" && "$b" != "$base" ]] || continue
        # Fast path: no commits beyond base -> merged or empty, safe to drop.
        # Squash path: a squash-merge rewrites the branch's commits into one new
        # commit on base, so the local branch still has "unique" commits and
        # looks diverged. Confirm via the merged PR before pruning, so genuine
        # diverged work (real unique commits, no merged PR) is always kept.
        if [[ "$(git rev-list --count "origin/$base..$b" 2>/dev/null || echo 1)" != "0" ]] \
           && ! git_branch_pr_merged "$b"; then
            continue
        fi
        git branch -q -D "$b" 2>/dev/null || true
    done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | awk '/\[gone\]/{print $1}')
}
