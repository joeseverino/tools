# shellcheck shell=bash
# shellcheck disable=SC2034
# Compatibility aggregator for the shared shell SDK. Existing tools source this
# file unchanged; new external consumers may source only lib/sdk/core.sh,
# lib/sdk/svmc.sh, or lib/sdk.sh.

: "${TOOLS_HOME:?common.sh needs TOOLS_HOME}"

# shellcheck source=lib/sdk/core.sh
source "$TOOLS_HOME/lib/sdk/core.sh"
# shellcheck source=lib/sdk/svmc.sh
source "$TOOLS_HOME/lib/sdk/svmc.sh"
# shellcheck source=lib/sdk/vault.sh
source "$TOOLS_HOME/lib/sdk/vault.sh"
# shellcheck source=lib/sdk/ci.sh
source "$TOOLS_HOME/lib/sdk/ci.sh"
# shellcheck source=lib/sdk/hq-state.sh
source "$TOOLS_HOME/lib/sdk/hq-state.sh"
