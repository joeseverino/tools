# shellcheck shell=bash

hq_sync_state_file() {
    printf '%s/severino-tools/hq-sync.json' "${XDG_STATE_HOME:-$HOME/.local/state}"
}

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
