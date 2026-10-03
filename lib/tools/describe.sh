# shellcheck shell=bash
# Cross-repo command-surface aggregation for `tools describe`.

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
            exec node "$TOOLS_HOME/lib/tools/describe-tui.ts" --repos
        else
            exec node "$TOOLS_HOME/lib/tools/describe-tui.ts"
        fi
    fi

    if [[ -n "$only" && -n "$only_cmd" ]]; then
        [[ -x "$TOOLS_HOME/bin/$only" ]] || die "error" "no such tool: $only"
        local -a style=(-c)
        (( pretty )) && style=(--indent 2)
        local projected
        projected="$("$TOOLS_HOME/bin/$only" --describe | jq "${style[@]}" --arg want "$only_cmd" '
            ([.commands[]? | select(.name == $want)] | first) as $cmd
            | if $cmd == null then
                {ok: false, error: "\(.name) has no command \u0027\($want)\u0027; commands: \([.commands[]?.name] | if length == 0 then "(none)" else join(", ") end)"}
              else {ok: true, schema_version, tool: .name} + $cmd end')" || return 1
        printf '%s\n' "$projected"
        [[ "$(jq -r .ok <<<"$projected")" == true ]] || return 1
        return 0
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
        if (( repos )); then
            local obsidian_contract="$CODE_HOME/Projects/severino-obsidian/contract/obsidian-commands.json"
            sig=$({ cat "$TOOLS_HOME"/bin/* "$TOOLS_HOME"/lib/*.sh \
                "$TOOLS_HOME"/lib/sdk/*.sh "$TOOLS_HOME"/lib/tools/describe.sh \
                "$TOOLS_HOME"/lib/tools/capabilities.ts \
                "$TOOLS_HOME"/lib/sdk/process.ts \
                "$TOOLS_HOME"/config/capabilities.json 2>/dev/null
                [[ -r "$obsidian_contract" ]] && cat "$obsidian_contract"
            } | cksum) || sig=""
        else
            sig=$(cat "$TOOLS_HOME"/bin/* "$TOOLS_HOME"/lib/*.sh \
                "$TOOLS_HOME"/lib/sdk/*.sh "$TOOLS_HOME"/lib/tools/describe.sh \
                2>/dev/null | cksum) || sig=""
        fi
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
            local capability_objs
            capability_objs=$(node "$TOOLS_HOME/lib/tools/capabilities.ts" run-all describe 2>/dev/null) \
                || capability_objs="[]"
            local obsidian_contract="$CODE_HOME/Projects/severino-obsidian/contract/obsidian-commands.json"
            if [[ -r "$obsidian_contract" ]] && out=$(cat "$obsidian_contract") && [[ "$out" == \{* ]]; then
                local capability_body="${capability_objs#[}"
                capability_body="${capability_body%]}"
                capability_objs="[${capability_body}${capability_body:+,}$out]"
            fi
            siblings=$(printf ',"siblings":%s' "$capability_objs")
        fi

        body=$(printf '{"ok":true,"schema_version":%d,"repo":"tools","tools":[%s]%s}' \
            "$DESCRIBE_SCHEMA_VERSION" "$(json_join "${objs[@]}")" "$siblings")

        if [[ -n "$cache_file" ]] && mkdir -p "$cache_dir" 2>/dev/null; then
            (printf '%s\n' "$body" > "$cache_file") 2>/dev/null || true
        fi
    fi

    if (( pretty )); then
        printf '%s\n' "$body" | jq --indent 4 .
    else
        printf '%s\n' "$body"
    fi
}
