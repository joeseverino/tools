# shellcheck shell=bash
# shellcheck disable=SC2034  # state arrays are read when the records are dumped
# describe.sh — the shell authoring DSL for a tool's command surface.
#
# A shell tool declares its surface in one function:
#
#     describe_spec() {
#         desc_tool "diagram" "Render Mermaid .mmd sources to neighboring PNG files."
#         desc_inventory "Authoring" 180
#         desc_synopsis "diagram <path>..."
#         desc_effect local_write
#         desc_pos path +variadic        -- "Mermaid source file or directory"
#         desc_env DIAGRAM_BRAND_KIT     -- "Brand kit directory override"
#         desc_example "diagram docs/diagrams/" -- "render every source there"
#     }
#     desc_help_intercept "$@"
#
# The declarations are streamed to lib/sdk/spec-cli.ts, which renders the help
# screens, the --describe contract and the deploy gate with the same code the
# TypeScript tools use (lib/sdk/surface.ts, usage.ts, tool.ts). TypeScript tools
# declare a typed ToolSpec instead and never source this file.
#
# Bash and zsh safe: records are packed into array elements with control-char
# separators and no numeric array indexing is used.

_DSEP=$'\037'
_DREC=$'\036'

describe_reset() {
    _D_CUR_CMD=""
    _D_REC=()
}

# Appends one record: kind, then fields joined by the field separator.
_describe_add() {
    local kind="$1"; shift
    local out="$kind" field
    for field in "$@"; do out+="${_DSEP}${field}"; done
    _D_REC+=("$out")
}

desc_tool() { _describe_add T "$1" "${2:-}"; }
desc_inventory() { _describe_add I "$1" "$2"; }
desc_leaf_commands() { _describe_add L; }
desc_synopsis() { _describe_add S "$1"; }
desc_para() { _describe_add P "$_D_CUR_CMD" "$1"; }

desc_cmd() {
    local name="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _describe_add C "$name" "${*:-}"
    _D_CUR_CMD="$name"
}

# desc_opt <flag-tokens...> -- <help...>
#   flag tokens: -x (short), --long (long), METAVAR, +repeat, and a quoted
#   "{a,b,c}" choices set (quoted so the shell does not brace-expand it).
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
    _describe_add O "$_D_CUR_CMD" "$short" "$long" "$metavar" "$choices" "$repeat" "${*:-}"
}

# desc_pos <name> [+optional] [+variadic] [{a,b,c}] -- <help...>
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
    _describe_add A "$_D_CUR_CMD" "$name" "$required" "$variadic" "$choices" "${*:-}"
}

# desc_delegate <owner> — this command's flags are owned by another repo.
desc_delegate() {
    local owner="$1"
    _describe_add D "$_D_CUR_CMD" "$owner"
}

# desc_effect <class> [+network] [+interactive] — every tool and command declares
# its blast radius: read | local_write | vault_write | remote_write | deploy.
desc_effect() {
    local class="$1"; shift
    local network=0 interactive=0
    case "$class" in
        read|local_write|vault_write|remote_write|deploy) ;;
        *) die "contract" "invalid effect '$class'" 2 ;;
    esac
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        case "$1" in
            +network)     network=1 ;;
            +interactive) interactive=1 ;;
            *) die "contract" "invalid effect tag '$1'" 2 ;;
        esac
        shift
    done
    _describe_add F "$_D_CUR_CMD" "$class" "$network" "$interactive"
}

desc_env() {
    local var="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _describe_add E "$var" "${*:-}"
}

desc_example() {
    local cmd="$1"; shift
    [[ "${1:-}" == "--" ]] && shift
    _describe_add X "$_D_CUR_CMD" "$cmd" "${*:-}"
}

# Runs spec-cli.ts with the declared records on fd 3, so the tool keeps its own
# stdin and stdout (the deploy confirmation reads the terminal).
_describe_node() {
    local data="" rec
    if (( ${#_D_REC[@]} )); then
        for rec in "${_D_REC[@]}"; do data+="${rec}${_DREC}"; done
    fi
    node "${TOOLS_HOME:?}/lib/sdk/spec-cli.ts" "$@" 3<<<"$data"
}

usage() {
    describe_reset
    describe_spec
    _describe_node usage
}

usage_command() {
    describe_reset
    describe_spec
    _describe_node usage-command "$1"
}

describe_emit() {
    local pretty=()
    local arg
    for arg in "$@"; do
        [[ "$arg" == "--pretty" ]] && pretty=(--pretty)
    done
    describe_reset
    describe_spec
    _describe_node describe ${pretty[@]+"${pretty[@]}"}
}

# desc_help_intercept "$@" — the one dispatch line a shell tool puts first. It
# renders and exits 0 for a help or contract request, runs the deploy gate for
# the resolved command, and otherwise returns so the tool dispatches.
desc_help_intercept() {
    case "${1:-}" in
        -h|--help)  usage; exit 0 ;;
        --describe) describe_emit "$@"; exit 0 ;;
    esac
    declare -f describe_spec >/dev/null || return 0
    describe_reset
    describe_spec
    local rc=0
    _describe_node intercept -- "$@" || rc=$?
    case "$rc" in
        0)   exit 0 ;;
        100) return 0 ;;
        *)   exit "$rc" ;;
    esac
}
