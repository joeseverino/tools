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

# Resolve the branch to work on, zombie-safe. Echoes the branch name.
#   - on main/master, or a branch with no unique commits vs origin/<base>
#     (merged, or a zombie left after a merge+delete) -> cut a fresh
#     <prefix>/<timestamp> off origin/<base>, carrying the working tree. Never
#     commits to main; never pushes a zombie.
#   - otherwise keep the current branch.
git_target_branch() {
    local base="$1" prefix="${2:-ship}" cur fresh
    cur="$(git symbolic-ref --short -q HEAD 2>/dev/null || echo HEAD)"
    if [[ "$cur" == "main" || "$cur" == "master" || "$cur" == "HEAD" ]] \
       || [[ "$(git_unique_commits "$base")" == "0" ]]; then
        fresh="$prefix/$(date +%Y%m%d-%H%M%S)"
        git checkout -q -b "$fresh" "origin/$base" || return 1
        printf '%s' "$fresh"
    else
        printf '%s' "$cur"
    fi
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
    url="$(gh pr list --head "$head" --base "$base" --json url -q '.[0].url' 2>/dev/null || true)"
    if [[ -n "$url" ]]; then
        local args=()
        [[ -n "$title" ]] && args+=(--title "$title")
        (( update_body )) && [[ -n "$body" ]] && args+=(--body "$body")
        (( ${#args[@]} )) && { gh pr edit "$url" "${args[@]}" >/dev/null 2>&1 || true; }
        printf '%s' "$url"; return 0
    fi
    if [[ -n "$title" ]]; then
        gh pr create --base "$base" --title "$title" --body "$body" >/dev/null 2>&1 || return 1
    else
        gh pr create --base "$base" --fill >/dev/null 2>&1 || return 1
    fi
    gh pr view --json url -q .url 2>/dev/null || true
}

# Land the current branch's PR: require green checks, then squash-merge + delete.
# Returns 2 when checks are not green, 1 on merge failure.
git_land() {
    gh pr checks >/dev/null 2>&1 || return 2
    gh pr merge --squash --delete-branch
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
        [[ "$(git rev-list --count "origin/$base..$b" 2>/dev/null || echo 1)" == "0" ]] || continue
        git branch -q -D "$b" 2>/dev/null || true
    done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | awk '/\[gone\]/{print $1}')
}
