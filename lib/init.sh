# shellcheck shell=bash
# init.sh — bootstrap for the personal CLI tools.
#
# Each tool sources this with one line, forwarding its own argv:
#
#     source "${TOOLS_HOME:?set in ~/.zshrc}/lib/init.sh" <config-name> "$@"
#
# Loads lib/common.sh + lib/describe.sh, then config/<config-name>.sh if a name
# was given. Pass an empty string (or omit) for tools that don't have a config.
#
# A tool's command surface renders from describe_spec (static strings), so
# `-h` / `--help` / `--describe` MUST work with no environment configured — the
# command-surface contract. Config files hard-gate their env (`${NOTES_HOME:?}`)
# at source time, which would otherwise kill help before desc_help_intercept
# runs. So when the forwarded argv is a help/describe request, we skip sourcing
# config entirely — describe_spec needs none of it. Real commands still get it.
# (`source ... "$@"` exposes the tool's argv here and restores the caller's
# afterward, in bash and zsh alike.)

: "${TOOLS_HOME:?set in ~/.zshrc}"

# shellcheck source=lib/common.sh
source "$TOOLS_HOME/lib/common.sh"
# Emit-once command-surface contract: the generic usage() + the --describe JSON
# renderer over a tool's describe_spec. Sourced for every tool, so defining
# describe_spec is all a tool needs to self-describe.
# shellcheck source=lib/describe.sh
source "$TOOLS_HOME/lib/describe.sh"

if [[ ${1-} ]]; then
    # $1 = config name; $2.. = the tool's own argv (forwarded). A help/describe
    # request reaches the renderer without config — match the same tokens
    # desc_help_intercept does (main: $2; focused `<cmd> -h`: $3).
    _init_help=0
    case "${2-}" in -h|--help|help|--describe|--describe=*) _init_help=1 ;; esac
    case "${3-}" in -h|--help) _init_help=1 ;; esac
    if [[ $_init_help -eq 0 ]]; then
        # shellcheck source=/dev/null
        source "$TOOLS_HOME/config/$1.sh"
    fi
    unset _init_help
fi
