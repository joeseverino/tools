# shellcheck shell=bash
# init.sh — bootstrap for shell tools that author their surface with the desc_*
# DSL (TypeScript tools use lib/sdk/tool.ts instead).
#
#     source "${TOOLS_HOME:?set in ~/.zshrc}/lib/init.sh" <config-name> "$@"
#
# Loads lib/common.sh and lib/describe.sh, then config/<config-name>.sh unless the
# forwarded argv is a help or describe request. Pass an empty name for tools with
# no config. A local config/<name>.sh wins; without one the tracked
# config/<name>.sh.example applies, so a clean checkout runs as-is.
#
# Config files hard-gate their environment (`${NOTES_HOME:?}`) at source time,
# which would kill -h before the help renderer ran, so help and describe requests
# skip the config. `source ... "$@"` exposes the tool's argv here and restores the
# caller's afterward, in bash and zsh alike.

: "${TOOLS_HOME:?set in ~/.zshrc}"

# shellcheck source=lib/common.sh
source "$TOOLS_HOME/lib/common.sh"
# shellcheck source=lib/describe.sh
source "$TOOLS_HOME/lib/describe.sh"

if [[ ${1-} ]]; then
    # $1 = config name; $2.. = the tool's own argv. Main help is $2, a focused
    # `<cmd> -h` is $3.
    _init_help=0
    case "${2-}" in -h|--help|help|--describe|--describe=*) _init_help=1 ;; esac
    case "${3-}" in -h|--help) _init_help=1 ;; esac
    if [[ $_init_help -eq 0 ]]; then
        if [[ -f "$TOOLS_HOME/config/$1.sh" ]]; then
            # shellcheck source=/dev/null
            source "$TOOLS_HOME/config/$1.sh"
        else
            # shellcheck source=/dev/null
            source "$TOOLS_HOME/config/$1.sh.example"
        fi
    fi
    unset _init_help
fi
