# shellcheck shell=bash
# Public shell SDK entry point for lightweight repo tools and one-off scripts.
# Provides result/output primitives plus the Cordon command declaration runtime.

: "${TOOLS_HOME:?set TOOLS_HOME before sourcing lib/sdk.sh}"
# shellcheck source=lib/sdk/core.sh
source "$TOOLS_HOME/lib/sdk/core.sh"
# shellcheck source=lib/describe.sh
source "$TOOLS_HOME/lib/describe.sh"
