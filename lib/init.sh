# shellcheck shell=bash
# init.sh — bootstrap for the personal CLI tools.
#
# Each tool sources this with one line:
#
#     source "${TOOLS_HOME:?set in ~/.zshrc}/lib/init.sh" <config-name>
#
# Loads lib/common.sh, then config/<config-name>.sh if a name was given.
# Pass an empty string (or omit) for tools that don't have a config file.

: "${TOOLS_HOME:?set in ~/.zshrc}"

# shellcheck source=lib/common.sh
source "$TOOLS_HOME/lib/common.sh"
# Emit-once command-surface contract: the generic usage() + the --describe JSON
# renderer over a tool's describe_spec. Sourced for every tool, so defining
# describe_spec is all a tool needs to self-describe.
# shellcheck source=lib/describe.sh
source "$TOOLS_HOME/lib/describe.sh"

if [[ ${1-} ]]; then
    # shellcheck source=/dev/null
    source "$TOOLS_HOME/config/$1.sh"
fi
