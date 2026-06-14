# shellcheck shell=bash
# Cross-repo command-surface aggregation for `tools describe`.

# cordon_schema_status — verify the vendored command-surface schema against its
# canonical source. schemas/cordon-v4.json is copied verbatim from the cordon
# repo (the single source of the contract); this is the one copy with no other
# drift guard, so resolve the canonical schema (CORDON_HOME, else the sibling
# checkout) and diff it. Sets two globals (not echoed — command substitution
# would drop a plain assignment):
#   CORDON_STATUS     synced | drifted | absent
#   CORDON_CANONICAL  the canonical path it compared against
# Re-vendor on drift: cp "$CORDON_CANONICAL" schemas/cordon-v4.json
# shellcheck disable=SC2034  # both globals are read by callers in bin/tools
cordon_schema_status() {
    local vendored="$TOOLS_HOME/schemas/cordon-v4.json"
    CORDON_CANONICAL="${CORDON_HOME:-$TOOLS_HOME/../cordon}/schema/cordon-v4.json"
    if [[ ! -f "$CORDON_CANONICAL" ]]; then
        CORDON_STATUS="absent"
    elif cmp -s "$vendored" "$CORDON_CANONICAL"; then
        CORDON_STATUS="synced"
    else
        CORDON_STATUS="drifted"
    fi
}

cmd_describe() {
    local pretty=0 repos=0 tui=0 only="" only_cmd=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --pretty)   pretty=1; shift ;;
            --repos)    repos=1; shift ;;
            --tui)      tui=1; shift ;;
            -*)         die_unknown option "$1" describe ;;
            *)          if [[ -z "$only" ]]; then only="$1"; else only_cmd="$1"; fi; shift ;;
        esac
    done

    if (( tui )); then
        [[ -z "$only" ]] || die "usage" "--tui describes the whole toolchain; drop the tool name ('$only' stays '$only -h')" 2
        if (( repos )); then
            exec node "$TOOLS_HOME/lib/tools/describe-tui.mjs" --repos
        else
            exec node "$TOOLS_HOME/lib/tools/describe-tui.mjs"
        fi
    fi

    if [[ -n "$only" && -n "$only_cmd" ]]; then
        [[ -x "$TOOLS_HOME/bin/$only" ]] || die "error" "no such tool: $only"
        "$TOOLS_HOME/bin/$only" --describe \
            | TOOLS_DESC_CMD="$only_cmd" TOOLS_DESC_PRETTY="$pretty" python3 -c '
import json, os, sys
want = os.environ["TOOLS_DESC_CMD"]
doc = json.load(sys.stdin)
cmd = next((c for c in doc.get("commands", []) if c["name"] == want), None)
if cmd is None:
    names = ", ".join(c["name"] for c in doc.get("commands", [])) or "(none)"
    print(json.dumps({"ok": False,
        "error": "%s has no command %r; commands: %s" % (doc.get("name"), want, names)}))
    sys.exit(1)
out = {"ok": True, "schema_version": doc.get("schema_version"), "tool": doc.get("name")}
out.update(cmd)
print(json.dumps(out, indent=2) if os.environ["TOOLS_DESC_PRETTY"] == "1" else json.dumps(out))
'
        return "${PIPESTATUS[1]}"
    fi

    if [[ -n "$only" ]]; then
        [[ -x "$TOOLS_HOME/bin/$only" ]] || die "error" "no such tool: $only"
        if (( pretty )); then
            "$TOOLS_HOME/bin/$only" --describe --pretty
        else
            "$TOOLS_HOME/bin/$only" --describe
        fi
        return $?
    fi

    # Warm cache. The federated document is byte-deterministic (no timestamps),
    # so re-running a --describe subprocess per tool on every call is wasted work
    # — it's the ~1.5s startup the `tools tui` / `tools generate` consumers pay.
    # Key on a content hash of every tool plus the shared describe/render libs
    # (reading those files is far cheaper than spawning a shell each), so any
    # edit to a spec or the renderer misses and re-federates; correctness never
    # lags content. --repos changes the body, so it joins the key. Best-effort:
    # an unhashable source or unwritable cache dir just falls through to a live
    # federation; TOOLS_DESCRIBE_NO_CACHE opts out entirely.
    local cache_dir cache_file="" body="" sig=""
    cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/severino-tools"
    if [[ -z "${TOOLS_DESCRIBE_NO_CACHE:-}" ]]; then
        sig=$(cat "$TOOLS_HOME"/bin/* "$TOOLS_HOME"/lib/*.sh \
            "$TOOLS_HOME"/lib/tools/describe.sh 2>/dev/null | cksum) || sig=""
        sig=${sig%% *}
    fi
    if [[ -n "$sig" ]]; then
        local key="describe-$sig"
        if (( repos )); then key="$key-repos"; fi
        cache_file="$cache_dir/$key.json"
        if [[ -r "$cache_file" ]]; then body=$(cat "$cache_file"); fi
    fi

    if [[ -z "$body" ]]; then
        local objs=() name out
        for name in "${TOOL_NAMES[@]}"; do
            if out=$("$TOOLS_HOME/bin/$name" --describe 2>/dev/null) && [[ "$out" == \{* ]]; then
                objs+=("$out")
            else
                objs+=("$(printf '{"ok":false,"name":"%s","error":"%s"}' \
                    "$(json_escape "$name")" "tool did not emit a describe contract")")
            fi
        done

        local siblings=""
        if (( repos )); then
            local sib_bins=(severino-vault-mcp) sib_objs=() bin
            for bin in "${sib_bins[@]}"; do
                if command -v "$bin" >/dev/null 2>&1 \
                    && out=$("$bin" describe 2>/dev/null) && [[ "$out" == \{* ]]; then
                    sib_objs+=("$out")
                fi
            done
            siblings=$(printf ',"siblings":[%s]' "$(json_join "${sib_objs[@]:-}")")
        fi

        body=$(printf '{"ok":true,"schema_version":%d,"repo":"tools","tools":[%s]%s}' \
            "$DESCRIBE_SCHEMA_VERSION" "$(json_join "${objs[@]}")" "$siblings")

        if [[ -n "$cache_file" ]] && mkdir -p "$cache_dir" 2>/dev/null; then
            (printf '%s\n' "$body" > "$cache_file") 2>/dev/null || true
        fi
    fi

    if (( pretty )) && command -v python3 >/dev/null 2>&1; then
        printf '%s\n' "$body" | python3 -m json.tool
    else
        printf '%s\n' "$body"
    fi
}
