# shellcheck shell=bash
# Public shell SDK entry point for lightweight repo tools and one-off scripts.
# Provides result/output primitives plus the Cordon command declaration runtime.

# shellcheck source=lib/sdk/core.sh
source "$(dirname -- "${BASH_SOURCE[0]:-$0}")/sdk/core.sh"
# shellcheck source=lib/describe.sh
source "$TOOLS_HOME/lib/describe.sh"
