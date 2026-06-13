# shellcheck shell=bash
# shellcheck disable=SC2034  # arrays/scalars are read by the renderers below
# describe.sh — emit-once command-surface contract for the personal CLI tools.
#
# The single source of truth for a tool's surface is one function it defines:
#
#     describe_spec() {
#         desc_tool "encrypt" "Encrypt files to your default age public key."
#         desc_synopsis "encrypt [options] <file>..."
#         desc_opt -c --copy             -- "Keep the original file (encrypt a copy)"
#         desc_opt -k --key PATH +repeat -- "Add another public key as a recipient"
#         desc_pos file +variadic        -- "File(s) to encrypt"
#         desc_env KEYS_HOME             -- "Read from ~/.zshrc; resolves AGE_PUBKEY"
#         desc_example "encrypt notes.md" -- "original removed"
#     }
#
# From that one declaration, two pure renderers derive every view — no prose is
# ever parsed, so the human help and the machine JSON cannot drift:
#
#   usage()                  the human heredoc (provided here; tools stop
#                            hand-writing it). Renders Usage / Commands /
#                            Options / Arguments / Environment / Examples.
#   describe_render_json     the stable, versioned JSON contract (below),
#                            byte-deterministic so guards can diff it.
#   describe_emit            the standard `--describe` handler: reset, run the
#                            tool's describe_spec, print JSON, honor --pretty.
#
# The JSON contract (a faithful superset of `severino-vault-mcp describe`):
#
#   { ok, schema_version, name, description,
#     global_options:[ <opt> ],   # flags valid everywhere (declared before any cmd)
#     positionals:[ <arg> ],      # leaf-tool direct positionals
#     commands:[ { name, summary, args:[ <arg> ] } ] }
#
#   <opt>/<arg> = { name, positional, required, help,
#                   flags?, choices?, takes_value?, repeatable? }
#
# desc_env / desc_example / desc_para are human-help only — environment and
# examples are guidance, not command surface, so (matching the MCP) they never
# enter the JSON.
#
# Portability: this is sourced by every tool, including the one zsh tool
# (dns-test). It is therefore written to run under bash AND zsh — no numeric
# array indexing (zsh arrays are 1-based), no `read -ra`. Records are packed
# into single array elements with a control-char separator and unpacked with
# IFS-`read`, which behaves the same in both shells.

DESCRIBE_SCHEMA_VERSION=1

# Field separator for the encoded records below (a control char that can't
# appear in option flags, help text, or names).
_DSEP=$'\037'

# describe_reset — clear all spec state. Called before each render so a tool's
# describe_spec is a pure declaration with no cross-call leakage.
describe_reset() {
    _D_NAME=""
    _D_DESC=""
    _D_CUR_CMD=""          # "" = top-level scope; else the open command name
    _D_SYNOPSIS=()
    _D_PARA=()
    _D_CMDS=()             # name <sep> summary
    _D_OPTS=()             # scope <sep> short <sep> long <sep> metavar <sep> choices <sep> repeat <sep> help
    _D_POS=()              # scope <sep> name <sep> required <sep> variadic <sep> choices <sep> help
    _D_ENV=()              # var <sep> help
    _D_EX=()               # command <sep> comment
}

# desc_tool <name> <one-line description>
desc_tool() {
    _D_NAME="$1"
    _D_DESC="${2:-}"
}

# desc_synopsis <usage line, sans the leading "Usage: ">
desc_synopsis() { _D_SYNOPSIS+=("$1"); }

# desc_para <paragraph> — human description blurb (usage only).
desc_para() { _D_PARA+=("$1"); }

# desc_cmd <name> -- <summary> — declare a subcommand and open its scope, so
# subsequent desc_opt/desc_pos attach to it.
desc_cmd() {
    local name="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _D_CMDS+=("${name}${_DSEP}${*:-}")
    _D_CUR_CMD="$name"
}

# desc_opt <flag-tokens...> -- <help...>
#   flag tokens: -x (short), --long (long), METAVAR, +repeat (repeatable).
#   A quoted "{a,b,c}" token becomes a choices set (quote it — unquoted braces
#   are eaten by shell brace expansion before the helper sees them). The
#   standard -h/--help is added by the renderer and never declared here.
desc_opt() {
    local short="" long="" metavar="" choices="" repeat=0
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        case "$1" in
            +repeat)    repeat=1 ;;
            --*)        long="$1" ;;
            -?)         short="$1" ;;
            \{*\})      choices="${1#\{}"; choices="${choices%\}}" ;;
            *)          metavar="$1" ;;
        esac
        shift
    done
    [[ "${1:-}" == "--" ]] && shift
    _D_OPTS+=("${_D_CUR_CMD}${_DSEP}${short}${_DSEP}${long}${_DSEP}${metavar}${_DSEP}${choices}${_DSEP}${repeat}${_DSEP}${*:-}")
}

# desc_pos <name> [+optional] [+variadic] [{a,b,c}] -- <help...>
#   A quoted "{a,b,c}" token marks a fixed choice set (same as desc_opt — quote
#   it so the shell doesn't brace-expand it). Choices ride into the JSON and
#   show in the usage label, so an action positional (e.g. cache|forget|status)
#   is structured surface, not prose.
desc_pos() {
    local name="$1"; shift
    local required=1 variadic=0 choices=""
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        case "$1" in
            +optional)  required=0 ;;
            +variadic)  variadic=1 ;;
            \{*\})      choices="${1#\{}"; choices="${choices%\}}" ;;
        esac
        shift
    done
    [[ "${1:-}" == "--" ]] && shift
    _D_POS+=("${_D_CUR_CMD}${_DSEP}${name}${_DSEP}${required}${_DSEP}${variadic}${_DSEP}${choices}${_DSEP}${*:-}")
}

# desc_env <VAR> -- <help...> — human help only.
desc_env() {
    local var="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _D_ENV+=("${var}${_DSEP}${*:-}")
}

# desc_example <command> [-- <comment>] — human help only.
desc_example() {
    local cmd="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _D_EX+=("${cmd}${_DSEP}${*:-}")
}

# ---------- usage renderer ----------

# Terminal width for wrapping: honor $COLUMNS, else `tput cols` on a tty, else
# a clean 80 when piped/redirected. Cached in _D_WIDTH per render.
_describe_termwidth() {
    local c
    if [[ -n "${COLUMNS:-}" ]]; then printf '%s' "$COLUMNS"; return; fi
    if [[ -t 1 ]] && c=$(tput cols 2>/dev/null) && [[ -n "$c" ]]; then
        printf '%s' "$c"; return
    fi
    printf '80'
}

# _describe_row <indent> <labelwidth> <label> <help>
# Print "  <label>   <help>" with the help word-wrapped to the terminal width
# and continuation lines hung under the help column — so long summaries never
# hard-break at column 0. Word-splitting is done by peeling (bash + zsh safe;
# zsh does not split unquoted parameters).
_describe_row() {
    local indent="$1" labelw="$2" label="$3" help="$4"
    local desc_col=$(( indent + labelw + 2 ))
    local avail=$(( ${_D_WIDTH:-80} - desc_col ))
    (( avail < 20 )) && avail=20

    local lines=() line="" rest="$help" word
    while [[ -n "$rest" ]]; do
        word="${rest%% *}"
        rest="${rest#"$word"}"; rest="${rest## }"
        if [[ -z "$line" ]]; then
            line="$word"
        elif (( ${#line} + 1 + ${#word} <= avail )); then
            line="$line $word"
        else
            lines+=("$line"); line="$word"
        fi
    done
    [[ -n "$line" ]] && lines+=("$line")
    (( ${#lines[@]} )) || lines=("")

    local first=1
    for line in "${lines[@]}"; do
        if (( first )); then
            printf '%*s%-*s  %s\n' "$indent" "" "$labelw" "$label" "$line"
            first=0
        else
            printf '%*s%s\n' "$desc_col" "" "$line"
        fi
    done
}

# The option label as shown to humans: "-c, --copy", "    --filter", with
# metavar/choices appended. Short-less options indent to align under "-x, ".
_describe_opt_label() {
    local short="$1" long="$2" metavar="$3" choices="$4" label
    if [[ -n "$short" && -n "$long" ]]; then
        label="$short, $long"
    elif [[ -n "$short" ]]; then
        label="$short"
    else
        label="    $long"
    fi
    if [[ -n "$choices" ]]; then
        label+=" {${choices}}"
    elif [[ -n "$metavar" ]]; then
        label+=" $metavar"
    fi
    printf '%s' "$label"
}

# describe_render_usage — print the human help for the current spec.
describe_render_usage() {
    local rec name summary var help cmd comment first
    local _D_WIDTH; _D_WIDTH=$(_describe_termwidth)

    # Usage line(s) — default to "<name> [options]" if none declared.
    if (( ${#_D_SYNOPSIS[@]} )); then
        first=1
        for rec in "${_D_SYNOPSIS[@]}"; do
            if (( first )); then printf 'Usage: %s\n' "$rec"; first=0
            else printf '       %s\n' "$rec"; fi
        done
    else
        printf 'Usage: %s [options]\n' "$_D_NAME"
    fi

    # Description blurb.
    if (( ${#_D_PARA[@]} )); then
        printf '\n'
        for rec in "${_D_PARA[@]}"; do printf '%s\n' "$rec"; done
    elif [[ -n "$_D_DESC" ]]; then
        printf '\n%s\n' "$_D_DESC"
    fi

    # Commands.
    if (( ${#_D_CMDS[@]} )); then
        local w=0
        for rec in "${_D_CMDS[@]}"; do
            name="${rec%%"$_DSEP"*}"
            (( ${#name} > w )) && w=${#name}
        done
        printf '\nCommands:\n'
        for rec in "${_D_CMDS[@]}"; do
            name="${rec%%"$_DSEP"*}"; summary="${rec#*"$_DSEP"}"
            _describe_row 2 "$w" "$name" "$summary"
        done
    fi

    # Top-level positionals (scope == "").
    _describe_render_pos_section "" "Arguments:"

    # Options: declared top-level options, then the universal -h/--help.
    _describe_render_opt_section "" "Options:" 1

    # Per-command detail (options + args) is reachable as focused help — git
    # style: the main screen stays a scannable command list regardless of how
    # many commands a tool has; `<tool> <cmd> -h` renders one command's scope
    # from the same spec (describe_render_usage_for). Surface the pointer only
    # when some command actually has documented args.
    if (( ${#_D_CMDS[@]} )); then
        for rec in "${_D_CMDS[@]}"; do
            name="${rec%%"$_DSEP"*}"
            if _describe_scope_has_args "$name"; then
                printf "\nRun '%s <command> -h' for a command's options and arguments.\n" "$_D_NAME"
                break
            fi
        done
    fi

    # Environment.
    if (( ${#_D_ENV[@]} )); then
        local w=0
        for rec in "${_D_ENV[@]}"; do
            var="${rec%%"$_DSEP"*}"
            (( ${#var} > w )) && w=${#var}
        done
        printf '\nEnvironment:\n'
        for rec in "${_D_ENV[@]}"; do
            var="${rec%%"$_DSEP"*}"; help="${rec#*"$_DSEP"}"
            _describe_row 2 "$w" "$var" "$help"
        done
    fi

    # Examples.
    if (( ${#_D_EX[@]} )); then
        local w=0
        for rec in "${_D_EX[@]}"; do
            cmd="${rec%%"$_DSEP"*}"
            (( ${#cmd} > w )) && w=${#cmd}
        done
        printf '\nExamples:\n'
        for rec in "${_D_EX[@]}"; do
            cmd="${rec%%"$_DSEP"*}"; comment="${rec#*"$_DSEP"}"
            if [[ -n "$comment" ]]; then
                printf '  %-*s  # %s\n' "$w" "$cmd" "$comment"
            else
                printf '  %s\n' "$cmd"
            fi
        done
    fi
}

# Positional placeholders for a scope's synopsis line: "<name>", "[<name>]",
# "<name>..." — built from _D_POS so the focused Usage line matches the spec.
_describe_pos_synopsis() {
    local want="$1" rec scope name required variadic choices help out=""
    (( ${#_D_POS[@]} )) || return 0
    for rec in "${_D_POS[@]}"; do
        IFS="$_DSEP" read -r scope name required variadic choices help <<<"$rec"
        [[ "$scope" == "$want" ]] || continue
        local token="<$name>"
        [[ -n "$choices" ]] && token="{${choices//,/|}}"
        (( ! required )) && token="[$token]"
        (( variadic )) && token="${token}..."
        out="${out:+$out }$token"
    done
    printf '%s' "$out"
}

# describe_render_usage_for <cmd> — focused help for a single command's scope:
# its summary, arguments, and options, rendered from the same spec the main
# usage and the JSON come from. Falls back to the full usage for an unknown
# command so `<tool> bogus -h` still helps.
describe_render_usage_for() {
    local want="$1"
    local _D_WIDTH; _D_WIDTH=$(_describe_termwidth)
    local rec name summary="" found=0
    if (( ${#_D_CMDS[@]} )); then
        for rec in "${_D_CMDS[@]}"; do
            name="${rec%%"$_DSEP"*}"
            if [[ "$name" == "$want" ]]; then found=1; summary="${rec#*"$_DSEP"}"; break; fi
        done
    fi
    if (( ! found )); then
        describe_render_usage
        return
    fi

    local pos; pos="$(_describe_pos_synopsis "$want")"
    printf 'Usage: %s %s [options]%s\n' "$_D_NAME" "$want" "${pos:+ $pos}"
    [[ -n "$summary" ]] && printf '\n%s\n' "$summary"
    _describe_render_pos_section "$want" "Arguments:"
    _describe_render_opt_section "$want" "Options:" 1
}

# usage_command <cmd> — the focused-help counterpart of usage(): a tool routes
# its `<tool> <cmd> -h` here so per-command help is derived, never hand-written.
usage_command() {
    describe_reset
    describe_spec
    describe_render_usage_for "$1"
}

# True if any opt/pos is scoped to the given command.
_describe_scope_has_args() {
    local want="$1" rec
    if (( ${#_D_POS[@]} )); then
        for rec in "${_D_POS[@]}"; do
            [[ "${rec%%"$_DSEP"*}" == "$want" ]] && return 0
        done
    fi
    if (( ${#_D_OPTS[@]} )); then
        for rec in "${_D_OPTS[@]}"; do
            [[ "${rec%%"$_DSEP"*}" == "$want" ]] && return 0
        done
    fi
    return 1
}

# _describe_render_pos_section <scope> <header|"">
_describe_render_pos_section() {
    local want="$1" header="$2" rec scope name required variadic choices help label w=0 any=0
    (( ${#_D_POS[@]} )) || return 0
    for rec in "${_D_POS[@]}"; do
        IFS="$_DSEP" read -r scope name required variadic choices help <<<"$rec"
        [[ "$scope" == "$want" ]] || continue
        any=1
        label="$name"; [[ -n "$choices" ]] && label="$name {$choices}"
        (( ${#label} > w )) && w=${#label}
    done
    (( any )) || return 0
    [[ -n "$header" ]] && printf '\n%s\n' "$header"
    for rec in "${_D_POS[@]}"; do
        IFS="$_DSEP" read -r scope name required variadic choices help <<<"$rec"
        [[ "$scope" == "$want" ]] || continue
        label="$name"; [[ -n "$choices" ]] && label="$name {$choices}"
        _describe_row 2 "$w" "$label" "$help"
    done
}

# _describe_render_opt_section <scope> <header|""> <add_help:0|1>
# Rows are packed "label<sep>help" so we never index two arrays in parallel
# (zsh-safe).
_describe_render_opt_section() {
    local want="$1" header="$2" add_help="$3"
    local rec scope short long metavar choices repeat help label w=0 any=0
    local rows=()
    if (( ${#_D_OPTS[@]} )); then
        for rec in "${_D_OPTS[@]}"; do
            IFS="$_DSEP" read -r scope short long metavar choices repeat help <<<"$rec"
            [[ "$scope" == "$want" ]] || continue
            any=1
            label="$(_describe_opt_label "$short" "$long" "$metavar" "$choices")"
            rows+=("${label}${_DSEP}${help}")
            (( ${#label} > w )) && w=${#label}
        done
    fi
    if (( add_help )); then
        any=1
        (( w < 10 )) && w=10
    fi
    (( any )) || return 0
    [[ -n "$header" ]] && printf '\n%s\n' "$header"
    if (( ${#rows[@]} )); then
        for rec in "${rows[@]}"; do
            label="${rec%%"$_DSEP"*}"; help="${rec#*"$_DSEP"}"
            _describe_row 2 "$w" "$label" "$help"
        done
    fi
    (( add_help )) && _describe_row 2 "$w" "-h, --help" "Show this help"
}

# Generic usage(): render the tool's declared spec. A tool becomes self-helping
# simply by defining describe_spec. Tools may still define their own usage() to
# override (sourced after this file).
usage() {
    describe_reset
    describe_spec
    describe_render_usage
}

# ---------- JSON renderer ----------

# _describe_choices_json <comma-list> — emit "choices":[...] (zsh-safe split).
_describe_choices_json() {
    local rest="$1" c parts=""
    while [[ -n "$rest" ]]; do
        c="${rest%%,*}"
        parts="${parts:+$parts,}\"$(json_escape "$c")\""
        if [[ "$rest" == *,* ]]; then rest="${rest#*,}"; else rest=""; fi
    done
    printf ',"choices":[%s]' "$parts"
}

# _describe_arg_json <positional:0|1> <name> <required:0|1> <help> \
#                    [short] [long] [metavar] [choices] [repeat]
_describe_arg_json() {
    local positional="$1" name="$2" required="$3" help="$4"
    local short="${5:-}" long="${6:-}" metavar="${7:-}" choices="${8:-}" repeat="${9:-0}"
    local out
    out=$(printf '{"name":"%s","positional":%s,"required":%s,"help":"%s"' \
        "$(json_escape "$name")" "$(json_bool "$positional")" \
        "$(json_bool "$required")" "$(json_escape "$help")")
    if (( ! positional )); then
        local flags=""
        [[ -n "$short" ]] && flags="\"$(json_escape "$short")\""
        [[ -n "$long"  ]] && flags="${flags:+$flags,}\"$(json_escape "$long")\""
        out+=$(printf ',"flags":[%s]' "$flags")
        if [[ -n "$metavar$choices" ]]; then
            out+=',"takes_value":true'
        else
            out+=',"takes_value":false'
        fi
    fi
    [[ -n "$choices" ]] && out+=$(_describe_choices_json "$choices")
    (( repeat )) && out+=',"repeatable":true'
    out+='}'
    printf '%s' "$out"
}

# Emit the args array (positionals first, then options) for a given scope.
_describe_args_for_scope() {
    local want="$1" rec scope items=""
    local name required variadic help short long metavar choices repeat optname item
    if (( ${#_D_POS[@]} )); then
        for rec in "${_D_POS[@]}"; do
            IFS="$_DSEP" read -r scope name required variadic choices help <<<"$rec"
            [[ "$scope" == "$want" ]] || continue
            item="$(_describe_arg_json 1 "$name" "$required" "$help" "" "" "" "$choices")"
            items="${items:+$items,}$item"
        done
    fi
    if (( ${#_D_OPTS[@]} )); then
        for rec in "${_D_OPTS[@]}"; do
            IFS="$_DSEP" read -r scope short long metavar choices repeat help <<<"$rec"
            [[ "$scope" == "$want" ]] || continue
            optname="${long:-$short}"
            item="$(_describe_arg_json 0 "$optname" 0 "$help" \
                "$short" "$long" "$metavar" "$choices" "$repeat")"
            items="${items:+$items,}$item"
        done
    fi
    printf '%s' "$items"
}

# Top-level options only (for global_options).
_describe_global_opts_json() {
    local rec scope short long metavar choices repeat help optname item items=""
    (( ${#_D_OPTS[@]} )) || return 0
    for rec in "${_D_OPTS[@]}"; do
        IFS="$_DSEP" read -r scope short long metavar choices repeat help <<<"$rec"
        [[ -z "$scope" ]] || continue
        optname="${long:-$short}"
        item="$(_describe_arg_json 0 "$optname" 0 "$help" \
            "$short" "$long" "$metavar" "$choices" "$repeat")"
        items="${items:+$items,}$item"
    done
    printf '%s' "$items"
}

# Top-level positionals only.
_describe_global_pos_json() {
    local rec scope name required variadic choices help item items=""
    (( ${#_D_POS[@]} )) || return 0
    for rec in "${_D_POS[@]}"; do
        IFS="$_DSEP" read -r scope name required variadic choices help <<<"$rec"
        [[ -z "$scope" ]] || continue
        item="$(_describe_arg_json 1 "$name" "$required" "$help" "" "" "" "$choices")"
        items="${items:+$items,}$item"
    done
    printf '%s' "$items"
}

# describe_render_json [--pretty] — print the contract for the current spec.
describe_render_json() {
    local pretty=0
    [[ "${1:-}" == "--pretty" ]] && pretty=1

    local out rec name summary cmds=""
    out=$(printf '{"ok":true,"schema_version":%d,"name":"%s","description":"%s"' \
        "$DESCRIBE_SCHEMA_VERSION" "$(json_escape "$_D_NAME")" "$(json_escape "$_D_DESC")")
    out+=$(printf ',"global_options":[%s]' "$(_describe_global_opts_json)")
    out+=$(printf ',"positionals":[%s]' "$(_describe_global_pos_json)")

    if (( ${#_D_CMDS[@]} )); then
        for rec in "${_D_CMDS[@]}"; do
            name="${rec%%"$_DSEP"*}"; summary="${rec#*"$_DSEP"}"
            cmds="${cmds:+$cmds,}$(printf '{"name":"%s","summary":"%s","args":[%s]}' \
                "$(json_escape "$name")" "$(json_escape "$summary")" \
                "$(_describe_args_for_scope "$name")")"
        done
    fi
    out+=$(printf ',"commands":[%s]}' "$cmds")

    if (( pretty )) && command -v python3 >/dev/null 2>&1; then
        printf '%s\n' "$out" | python3 -m json.tool
    else
        printf '%s\n' "$out"
    fi
}

# describe_emit [--pretty] — the standard `--describe` handler. A tool wires it
# with one dispatch line:  --describe) describe_emit "$@"; exit 0 ;;
describe_emit() {
    local pretty=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --pretty)   pretty="--pretty" ;;
            *) ;;
        esac
        shift
    done
    describe_reset
    describe_spec
    describe_render_json $pretty
}
