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

# shellcheck source=common.sh
source "$TOOLS_HOME/lib/common.sh"

if [[ ${1-} ]]; then
    # shellcheck source=/dev/null
    source "$TOOLS_HOME/config/$1.sh"
fi
