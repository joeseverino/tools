# shellcheck shell=bash
# shellcheck disable=SC2034
# Compatibility aggregator for the shared shell SDK. Existing tools source this
# file unchanged; new external consumers may source only lib/sdk/core.sh,
# lib/sdk/svmc.sh, or lib/sdk.sh.

# shellcheck source=lib/sdk/core.sh
source "$(dirname -- "${BASH_SOURCE[0]:-$0}")/sdk/core.sh"
# shellcheck source=lib/sdk/svmc.sh
source "$TOOLS_HOME/lib/sdk/svmc.sh"
# shellcheck source=lib/sdk/ci.sh
source "$TOOLS_HOME/lib/sdk/ci.sh"
