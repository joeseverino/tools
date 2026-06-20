# shellcheck shell=bash
# shellcheck disable=SC2034
# config/repos.sh — repo fleet workflow policy

# Repos that are intentionally local-only. `repos --json` emits local_ok=true
# for these, and workflow consumers should not count their missing remote or
# upstream as attention needed.
REPOS_LOCAL_OK=(
    Backups
    screencasts
    fitness-dashboard
)
