# shellcheck shell=bash
# helpers.bash — shared bats setup for the tools test suite.
#
# Tests are hermetic: every path lives under $BATS_TEST_TMPDIR and the
# crypt key is a throwaway unpassphrased ed25519, which unlock_age_key
# uses directly — no Keychain, no prompts, no real keys.

export TOOLS_HOME
TOOLS_HOME="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

# setup_crypt — generate a throwaway key pair laid out the way
# config/crypt.sh expects ($KEYS_HOME/file_key/file_key{,.pub}).
setup_crypt() {
    export KEYS_HOME="$BATS_TEST_TMPDIR/keys"
    mkdir -p "$KEYS_HOME/file_key"
    ssh-keygen -q -t ed25519 -N "" -C "tools-test" \
        -f "$KEYS_HOME/file_key/file_key"
}

# setup_memory — empty memory dir for remember tests.
setup_memory() {
    export MEMORY_DIR="$BATS_TEST_TMPDIR/memory"
    mkdir -p "$MEMORY_DIR"
}

# setup_manage — hermetic env for the site manage TUI: the fake MCP fixture
# shadows the real one on PATH, the site repo is an empty tmpdir, and the
# live-site probe points at a port that refuses instantly.
setup_manage() {
    export PATH="$BATS_TEST_DIRNAME/fixtures:$PATH"
    export SITE_HOME="$BATS_TEST_TMPDIR/site"
    mkdir -p "$SITE_HOME"
    export SITE_LIVE_URL="http://127.0.0.1:9"
    export FAKE_MCP_LOG="$BATS_TEST_TMPDIR/mcp-calls.log"
    export SITE_SKIP_MCP_DRIFT_CHECK=1
}

encrypt_bin() { "$TOOLS_HOME/bin/encrypt" "$@"; }
decrypt_bin() { "$TOOLS_HOME/bin/decrypt" "$@"; }
remember_bin() { "$TOOLS_HOME/bin/remember" "$@"; }
