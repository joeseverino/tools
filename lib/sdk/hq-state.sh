# shellcheck shell=bash

# hq_sync_state_file — where `hq sync` records what it shipped (manifest hash
# + inputs), so `vault status` and `hq doctor` can detect staleness exactly
# instead of relying on the "remember to run hq sync" convention.
hq_sync_state_file() {
    printf '%s/severino-tools/hq-sync.json' "${XDG_STATE_HOME:-$HOME/.local/state}"
}

# hq_sync_freshness <vault-path> — compare the vault's current HQ manifest
# hash against the one recorded by the last successful `hq sync`. Prints:
#   never | skip | fresh <date> | stale <date>
# ("skip": check can't run here — no MCP CLI, or state from another vault.)
# Exact by construction: the hash covers precisely the frontmatter manifest HQ
# imports (dirs read back from the state file; "mcp-default" replays the MCP's
# derived default), so prose-only edits and unrelated commits never flag.
hq_sync_freshness() {
    local vault_path="$1" state sha dirs synced state_vault current manifest
    state="$(hq_sync_state_file)"
    [[ -f "$state" ]] || { echo "never"; return 0; }
    svmc_available || { echo "skip"; return 0; }
    IFS=$'\t' read -r sha dirs synced state_vault < <(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
print(s.get("manifest_sha256", ""), s.get("vault_dirs", ""),
      s.get("synced_at", ""), s.get("vault", ""), sep="\t")
' "$state" 2>/dev/null) || { echo "skip"; return 0; }
    [[ -n "$sha" && -n "$dirs" && "$state_vault" == "$vault_path" ]] \
        || { echo "skip"; return 0; }
    if [[ "$dirs" == "mcp-default" ]]; then
        manifest="$(SVMC_VAULT_PATH="$vault_path" svmc hq-manifest "$vault_path" 2>/dev/null)" \
            || { echo "skip"; return 0; }
    else
        manifest="$(SVMC_VAULT_PATH="$vault_path" svmc hq-manifest "$vault_path" "$dirs" 2>/dev/null)" \
            || { echo "skip"; return 0; }
    fi
    [[ -n "$manifest" ]] || { echo "skip"; return 0; }
    current="$(printf '%s\n' "$manifest" | shasum -a 256 | cut -d' ' -f1)"
    if [[ "$current" == "$sha" ]]; then echo "fresh ${synced%%T*}"
    else echo "stale ${synced%%T*}"
    fi
}
