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
# The JSON contract (schema_version 4 — a superset of `severino-vault-mcp describe`):
#
#   { ok, schema_version, name, description, group, order,
#     effect, network?, interactive?,   # tool-level blast radius (leaf tools)
#     global_options:[ <opt> ],   # flags valid everywhere (declared before any cmd)
#     positionals:[ <arg> ],      # leaf-tool direct positionals
#     paras:[ "<prose>" ],        # tool-level prose (global-scope desc_para)
#     examples:[ <example> ],     # tool-level examples (global-scope desc_example)
#     commands:[ { name, summary, args:[ <arg> ],
#                  effect, network?, interactive?,   # this command's blast radius
#                  paras:[ "<prose>" ], examples:[ <example> ],
#                  delegates?: "<owner>" } ] }    # delegates = flags owned elsewhere
#
#   <opt>/<arg> = { name, positional, required, help,
#                   flags?, choices?, takes_value?, repeatable?, variadic? }
#   <example>   = { command, comment }
#
# v2 added paras / examples / delegates so an agent can read a command's intent,
# usage, and external flag-ownership from the JSON alone (without re-reading the
# handler). v3 adds the EFFECT triple — effect (one of read | local_write |
# vault_write | remote_write | deploy, escalating blast radius) plus the boolean
# tags network / interactive — declared by desc_effect. It is the structured
# signal an agent risk-gates on before running a command (read vs deploy), the
# one fact it can't derive from flags. effect is always emitted (default read);
# network / interactive only when true. desc_env stays human-help only. desc_para
# / desc_example / desc_effect are scoped to the current command, like desc_opt.
# v4 adds required group / order inventory metadata and explicit metavar /
# variadic fields. Aggregate renderers use order instead of inventing their own
# sort, and validation rejects duplicate order values.
#
# Portability: this is sourced by every tool, including the one zsh tool
# (dns-test). It is therefore written to run under bash AND zsh — no numeric
# array indexing (zsh arrays are 1-based), no `read -ra`. Records are packed
# into single array elements with a control-char separator and unpacked with
# IFS-`read`, which behaves the same in both shells.

DESCRIBE_SCHEMA_VERSION=4

# Field separator for the encoded records below (a control char that can't
# appear in option flags, help text, or names).
_DSEP=$'\037'

# describe_reset — clear all spec state. Called before each render so a tool's
# describe_spec is a pure declaration with no cross-call leakage.
describe_reset() {
    _D_NAME=""
    _D_DESC=""
    _D_GROUP=""
    _D_ORDER=""
    _D_CUR_CMD=""          # "" = top-level scope; else the open command name
    _D_SYNOPSIS=()
    _D_PARA=()             # scope <sep> paragraph
    _D_CMDS=()             # name <sep> summary
    _D_OPTS=()             # scope <sep> short <sep> long <sep> metavar <sep> choices <sep> repeat <sep> help
    _D_POS=()              # scope <sep> name <sep> required <sep> variadic <sep> choices <sep> help
    _D_ENV=()              # var <sep> help
    _D_EX=()               # scope <sep> command <sep> comment
    _D_DELEGATE=()         # scope <sep> owner (command's flags owned by another repo)
    _D_EFFECT=()           # scope <sep> effect <sep> network <sep> interactive
}

# desc_tool <name> <one-line description>
desc_tool() {
    _D_NAME="$1"
    _D_DESC="${2:-}"
}

# desc_inventory <group> <order> — stable presentation metadata for aggregate
# consumers. The order is global and unique across this repo; group preserves
# the operator-facing information architecture instead of alphabetizing tools.
desc_inventory() {
    _D_GROUP="$1"
    _D_ORDER="$2"
}

# desc_synopsis <usage line, sans the leading "Usage: ">
desc_synopsis() { _D_SYNOPSIS+=("$1"); }

# desc_para <paragraph> — human prose, usage only. Scoped like desc_opt/desc_pos:
# before any desc_cmd it is the tool blurb (main screen); after a desc_cmd it is
# that command's prose (focused screen). So per-command help is spec-derived too.
desc_para() { _D_PARA+=("${_D_CUR_CMD}${_DSEP}$1"); }

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

# desc_delegate <owner...> — declare (after a desc_cmd) that this command's flag
# surface is OWNED by another repo and is not enumerated here, to avoid drift
# (e.g. `hq create` → HQ's manage.py; site's npm-script wrappers). It is
# structured, not prose: it renders in the command's focused help AND rides into
# the JSON as "delegates", so an agent can see ownership without reading handlers.
desc_delegate() {
    local owner="$1"; shift || true
    [[ "${1:-}" == "--" ]] && shift
    _D_DELEGATE+=("${_D_CUR_CMD}${_DSEP}${owner}")
}

# desc_effect <class> [+network] [+interactive] — declare a command's (or, before
# the first desc_cmd, the leaf tool's) blast radius and reach. <class> escalates:
#   read | local_write | vault_write | remote_write | deploy
# Optional tags: +network (the requested operation reaches a remote / API / SSH)
# and +interactive (needs a TTY). Dependency installation or a package-manager
# cache miss does not make an otherwise local operation networked. Scoped like
# desc_opt/desc_para. It is the structured signal an agent risk-gates on before
# running a command — the one fact it can't read off the flags — and rides into
# the JSON as effect / network / interactive. Undeclared defaults to read (no
# mutation, no remote operation); declare it on anything that mutates, reaches
# off-box as part of its requested operation, or blocks on a TTY.
desc_effect() {
    local class="$1"; shift
    local network=0 interactive=0
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        case "$1" in
            +network)     network=1 ;;
            +interactive) interactive=1 ;;
        esac
        shift
    done
    _D_EFFECT+=("${_D_CUR_CMD}${_DSEP}${class}${_DSEP}${network}${_DSEP}${interactive}")
}

# desc_env <VAR> -- <help...> — human help only.
desc_env() {
    local var="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _D_ENV+=("${var}${_DSEP}${*:-}")
}

# desc_example <command> [-- <comment>] — human help only. Scoped like desc_para:
# before any desc_cmd it shows on the main screen; after one, in that command's
# focused help.
desc_example() {
    local cmd="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _D_EX+=("${_D_CUR_CMD}${_DSEP}${cmd}${_DSEP}${*:-}")
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

    # Description blurb: tool-level (global-scope) prose, else the one-liner.
    if ! _describe_render_para_section ""; then
        [[ -n "$_D_DESC" ]] && printf '\n%s\n' "$_D_DESC"
    fi

    # Effect line for a leaf tool (tool-level scope) — e.g. encrypt is a
    # local_write. Command tools leave this at the default read and show nothing.
    _describe_render_effect_line ""

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

    # Examples (tool-level / global scope).
    _describe_render_example_section ""
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
    _describe_render_para_section "$want" || true
    _describe_render_effect_line "$want"
    local owner; owner="$(_describe_delegate_for "$want")"
    [[ -n "$owner" ]] && printf '\nFlags are owned elsewhere: %s\n' "$owner"
    _describe_render_pos_section "$want" "Arguments:"
    _describe_render_opt_section "$want" "Options:" 1
    _describe_render_example_section "$want"
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

# _describe_wrap <text> <width> — print <text> word-wrapped to <width> columns,
# one line per output row. Word-splitting is done by peeling (bash + zsh safe).
# This is why a paragraph is stored as ONE unwrapped logical string in the
# contract: every renderer (this -h, the README, the TUI) reflows it to its own
# width, so no presentation line-breaks are baked into the source of truth.
_describe_wrap() {
    local rest="$1" width="$2" line="" word
    (( width < 20 )) && width=20
    while [[ -n "$rest" ]]; do
        word="${rest%% *}"
        rest="${rest#"$word"}"; rest="${rest## }"
        if [[ -z "$line" ]]; then
            line="$word"
        elif (( ${#line} + 1 + ${#word} <= width )); then
            line="$line $word"
        else
            printf '%s\n' "$line"; line="$word"
        fi
    done
    [[ -n "$line" ]] && printf '%s\n' "$line"
}

# _describe_render_para_section <scope> — print the prose paragraphs declared for
# a scope, each preceded by a blank line and reflowed to the terminal width. Same
# scope-filter shape as the pos/opt sections. Returns 0 if any printed, 1 if none
# (lets usage fall back to _D_DESC).
_describe_render_para_section() {
    local want="$1" rec scope text printed=0
    (( ${#_D_PARA[@]} )) || return 1
    for rec in "${_D_PARA[@]}"; do
        scope="${rec%%"$_DSEP"*}"; text="${rec#*"$_DSEP"}"
        [[ "$scope" == "$want" ]] || continue
        printf '\n'
        _describe_wrap "$text" "${_D_WIDTH:-80}"
        printed=1
    done
    (( printed )) || return 1
    return 0
}

# _describe_delegate_for <scope> — print the owner string for a scope (or ""),
# so a command whose flags live in another repo names the owner once.
_describe_delegate_for() {
    local want="$1" rec scope owner
    (( ${#_D_DELEGATE[@]} )) || return 0
    for rec in "${_D_DELEGATE[@]}"; do
        scope="${rec%%"$_DSEP"*}"; owner="${rec#*"$_DSEP"}"
        [[ "$scope" == "$want" ]] || continue
        printf '%s' "$owner"; return 0
    done
}

# _describe_effect_for <scope> — print "effect<sep>network<sep>interactive" for a
# scope, defaulting to read / 0 / 0 when none was declared. Consumed by both the
# usage line and the JSON, so the two can't drift.
_describe_effect_for() {
    local want="$1" rec scope effect network interactive
    if (( ${#_D_EFFECT[@]} )); then
        for rec in "${_D_EFFECT[@]}"; do
            IFS="$_DSEP" read -r scope effect network interactive <<<"$rec"
            if [[ "$scope" == "$want" ]]; then
                printf '%s%s%s%s%s' "$effect" "$_DSEP" "$network" "$_DSEP" "$interactive"
                return 0
            fi
        done
    fi
    printf 'read%s0%s0' "$_DSEP" "$_DSEP"
}

# _describe_render_effect_line <scope> — print "Effect: <class> · network · …",
# but only when it carries information (anything other than a plain read). A
# read-only, off-network command shows nothing, keeping the common help clean.
_describe_render_effect_line() {
    local want="$1" eff net ia tags
    IFS="$_DSEP" read -r eff net ia <<<"$(_describe_effect_for "$want")"
    [[ "$eff" == read && "$net" == 0 && "$ia" == 0 ]] && return 0
    tags="$eff"
    (( net )) && tags="$tags · network"
    (( ia )) && tags="$tags · interactive"
    printf '\nEffect: %s\n' "$tags"
}

# _describe_render_example_section <scope> — the Examples block for a scope.
_describe_render_example_section() {
    local want="$1" rec scope cmd comment w=0 any=0
    (( ${#_D_EX[@]} )) || return 0
    for rec in "${_D_EX[@]}"; do
        IFS="$_DSEP" read -r scope cmd comment <<<"$rec"
        [[ "$scope" == "$want" ]] || continue
        any=1
        (( ${#cmd} > w )) && w=${#cmd}
    done
    (( any )) || return 0
    printf '\nExamples:\n'
    for rec in "${_D_EX[@]}"; do
        IFS="$_DSEP" read -r scope cmd comment <<<"$rec"
        [[ "$scope" == "$want" ]] || continue
        if [[ -n "$comment" ]]; then
            printf '  %-*s  # %s\n' "$w" "$cmd" "$comment"
        else
            printf '  %s\n' "$cmd"
        fi
    done
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
#                    [short] [long] [metavar] [choices] [repeat] [variadic]
_describe_arg_json() {
    local positional="$1" name="$2" required="$3" help="$4"
    local short="${5:-}" long="${6:-}" metavar="${7:-}" choices="${8:-}" repeat="${9:-0}"
    local variadic="${10:-0}"
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
        [[ -n "$metavar" ]] && out+=',"metavar":"'"$(json_escape "$metavar")"'"'
    fi
    [[ -n "$choices" ]] && out+=$(_describe_choices_json "$choices")
    (( repeat )) && out+=',"repeatable":true'
    (( variadic )) && out+=',"variadic":true'
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
            item="$(_describe_arg_json 1 "$name" "$required" "$help" "" "" "" "$choices" 0 "$variadic")"
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
        item="$(_describe_arg_json 1 "$name" "$required" "$help" "" "" "" "$choices" 0 "$variadic")"
        items="${items:+$items,}$item"
    done
    printf '%s' "$items"
}

# Paragraphs (prose) for a scope, as a JSON string array. Human-help that now
# also rides into the JSON so an agent can read a command's intent.
_describe_paras_json() {
    local want="$1" rec scope text items=""
    (( ${#_D_PARA[@]} )) || { printf ''; return 0; }
    for rec in "${_D_PARA[@]}"; do
        scope="${rec%%"$_DSEP"*}"; text="${rec#*"$_DSEP"}"
        [[ "$scope" == "$want" ]] || continue
        items="${items:+$items,}\"$(json_escape "$text")\""
    done
    printf '%s' "$items"
}

# Examples for a scope, as a JSON array of {command, comment}.
_describe_examples_json() {
    local want="$1" rec scope cmd comment items=""
    (( ${#_D_EX[@]} )) || { printf ''; return 0; }
    for rec in "${_D_EX[@]}"; do
        IFS="$_DSEP" read -r scope cmd comment <<<"$rec"
        [[ "$scope" == "$want" ]] || continue
        items="${items:+$items,}$(printf '{"command":"%s","comment":"%s"}' \
            "$(json_escape "$cmd")" "$(json_escape "$comment")")"
    done
    printf '%s' "$items"
}

# _describe_effect_json <scope> — ',"effect":"<class>"[,"network":true]
# [,"interactive":true]'. effect is always emitted (default read); the boolean
# tags only when true, to keep the document lean (same shape as repeatable).
_describe_effect_json() {
    local eff net ia
    IFS="$_DSEP" read -r eff net ia <<<"$(_describe_effect_for "$1")"
    printf ',"effect":"%s"' "$(json_escape "$eff")"
    # if/fi (not a bare `(( )) &&`) so the function's exit status is always 0 —
    # this runs in `out+=$(...)`, where a trailing non-zero would trip set -e.
    if (( net )); then printf ',"network":true'; fi
    if (( ia  )); then printf ',"interactive":true'; fi
}

# describe_render_json [--pretty] — print the contract for the current spec.
describe_render_json() {
    local pretty=0
    [[ "${1:-}" == "--pretty" ]] && pretty=1

    local out rec name summary cmds=""
    out=$(printf '{"ok":true,"schema_version":%d,"name":"%s","description":"%s","group":"%s","order":%d' \
        "$DESCRIBE_SCHEMA_VERSION" "$(json_escape "$_D_NAME")" "$(json_escape "$_D_DESC")" \
        "$(json_escape "$_D_GROUP")" "${_D_ORDER:-0}")
    # Tool-level blast radius (meaningful for leaf tools; read for command tools).
    out+=$(_describe_effect_json "")
    out+=$(printf ',"global_options":[%s]' "$(_describe_global_opts_json)")
    out+=$(printf ',"positionals":[%s]' "$(_describe_global_pos_json)")
    # Tool-level (global-scope) prose + examples — the signals an agent uses to
    # understand a tool without reading its source.
    out+=$(printf ',"paras":[%s]' "$(_describe_paras_json "")")
    out+=$(printf ',"examples":[%s]' "$(_describe_examples_json "")")

    if (( ${#_D_CMDS[@]} )); then
        local owner delegate_json
        for rec in "${_D_CMDS[@]}"; do
            name="${rec%%"$_DSEP"*}"; summary="${rec#*"$_DSEP"}"
            owner="$(_describe_delegate_for "$name")"
            if [[ -n "$owner" ]]; then
                delegate_json=$(printf ',"delegates":"%s"' "$(json_escape "$owner")")
            else
                delegate_json=""
            fi
            cmds="${cmds:+$cmds,}$(printf '{"name":"%s","summary":"%s","args":[%s]%s,"paras":[%s],"examples":[%s]%s}' \
                "$(json_escape "$name")" "$(json_escape "$summary")" \
                "$(_describe_args_for_scope "$name")" \
                "$(_describe_effect_json "$name")" \
                "$(_describe_paras_json "$name")" \
                "$(_describe_examples_json "$name")" \
                "$delegate_json")"
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

# desc_help_intercept "$@" — THE one dispatch line every tool puts first, for
# BOTH leaf and subcommand tools. It renders the whole help + machine surface
# from the single describe_spec and exits for a help/contract request; what it
# does past the shared top is DERIVED from the spec's shape, never restated by
# the tool. Subcommand tool — call it, then write only the command→action map:
#
#     desc_help_intercept "$@"
#     case "${1:-}" in
#         build) shift; cmd_build "$@" ;;
#         ...
#     esac
#
# Leaf tool (declares no desc_cmd) — call it, then parse the tool's own
# options/positionals; it never hand-routes -h/--help/--describe again.
#
# It renders and exits 0 on a help/describe request, so a help flag can never
# fall through to run an action:
#   -h | --help            -> usage              main screen    (every tool)
#   --describe [--pretty]   -> describe_emit      JSON contract  (every tool)
#   (no args | help)        -> usage              main screen    (subcommand tools)
#   <cmd> (-h | --help)     -> usage_command <cmd> focused screen (subcommand tools)
# then it runs the blast-radius gate for the resolved scope — the named command,
# or the tool itself for a leaf — and returns, letting the caller dispatch.
#
# Leaf vs subcommand is read from the spec itself (does it declare any desc_cmd?),
# so adding or removing a subcommand re-routes dispatch with no second edit. A
# leaf's bare / `help` invocation is the tool's own to define (`backup` runs,
# `encrypt` errors with its usage), so the intercept deliberately does NOT claim
# those for a leaf — only the unambiguous -h/--help/--describe meta-flags.
desc_help_intercept() {
    # Meta-flags are universal — unambiguous for every tool, leaf or subcommand.
    case "${1:-}" in
        -h|--help)  usage; exit 0 ;;
        --describe) describe_emit "$@"; exit 0 ;;
    esac
    # Past here behavior is spec-shape-specific. With no describe_spec
    # (lib/drift.sh's hermetic harness overrides usage and declares none) there
    # is nothing to inspect, route, or gate — hand back to the caller.
    declare -F describe_spec >/dev/null || return 0
    describe_reset; describe_spec
    if (( ${#_D_CMDS[@]} == 0 )); then
        desc_guard_effect ""        # leaf: gate the tool-level effect, then hand back
        return 0
    fi
    case "${1:-}" in ''|help) usage; exit 0 ;; esac
    case "${2:-}" in -h|--help) usage_command "$1"; exit 0 ;; esac
    desc_guard_effect "$1"
}

# desc_guard_effect <scope> — the runtime renderer of the effect contract: the
# warning, derived from the same `desc_effect` line that feeds -h / the README /
# the agent JSON, never hand-wired per command. A `deploy` (the top of the
# read→deploy ladder — it ships to prod) requires an explicit confirmation, so a
# stray `hq ship` / `site deploy` can't fire by accident, by hand OR by an agent.
# Bypass with TOOLS_ASSUME_YES=1 (intentional automation / CI); a non-interactive
# shell without it fails closed rather than deploying blind. Every tool inherits
# this for free — it runs from the one intercept they already call, so a new
# deploy command is gated the moment it declares its effect, with zero wiring.
desc_guard_effect() {
    local cmd="$1"   # a command name for a subcommand tool, or "" = the leaf tool itself
    # No spec means no declared effect (defaults to read) — nothing to gate. Also
    # keeps lib/drift.sh's hermetic test harness, which overrides usage() and
    # never declares describe_spec, working unchanged.
    declare -F describe_spec >/dev/null || return 0
    describe_reset
    describe_spec
    local eff; eff="$(_describe_effect_for "$cmd")"; eff="${eff%%"$_DSEP"*}"
    [[ "$eff" == deploy ]] || return 0
    [[ -n "${TOOLS_ASSUME_YES:-}" ]] && return 0
    if [[ ! -t 0 || ! -t 1 ]]; then
        die "blocked" "'$_D_NAME $cmd' is a deploy — set TOOLS_ASSUME_YES=1 to run non-interactively" 2
    fi
    local reply
    printf '  %s%-10s%s %s deploys to prod (%s %s). Continue? [y/N] ' \
        "$YELLOW$BOLD" "confirm" "$RESET" "$_D_NAME" "$_D_NAME" "$cmd" > /dev/tty
    read -r reply < /dev/tty || reply=""
    case "$reply" in
        y|Y|yes|YES) ;;
        *) die "aborted" "deploy cancelled" 130 ;;
    esac
}
