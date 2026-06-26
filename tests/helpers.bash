# shellcheck shell=bash
# helpers.bash — shared bats setup for the tools test suite.
#
# Tests are hermetic: every path lives under $BATS_TEST_TMPDIR and the
# crypt key is a throwaway unpassphrased ed25519, which unlock_age_key
# uses directly — no Keychain, no prompts, no real keys.

export TOOLS_HOME
TOOLS_HOME="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

# The CI-equivalent shell environment is defined once in lib/common.sh and
# reused here (and by `tools check --ci`) so the two can't drift — emit once,
# derive everywhere. Source it for ci_shell_env (and the msg/color/json helpers
# a few tests assert against).
source "$TOOLS_HOME/lib/common.sh"

# Hermetic env: clear the layout/config vars the operator's ~/.zshrc exports, so
# the suite behaves identically on a dev machine and in clean CI. Without this, a
# regression that makes a tool need real env for `-h`/`--describe` would pass
# locally (vars leak in) and only fail in CI — which is exactly how the help
# paths' config-source gate slipped through once. Tests that need a real value
# set their own (setup_crypt, setup_manage, the hq/site fixtures) after this.
unset NOTES_HOME VAULT INBOX_DIR KEYS_HOME BACKUPS_HOME AGE_PUBKEY AGE_KEY \
      CODE_HOME SITE_HOME HQ_SSH_HOST HQ_REMOTE_PATH HQ_URL HQ_VAULT_DIRS \
      HQ_LOCAL_PATH HQ_SCHEMA_DOC ADGUARD_URL ADGUARD_CREDS \
      ADGUARD_VAULT_DOC ADGUARD_VAULT_HEADING CF_DNS_VAULT_DOC \
      CF_DNS_VAULT_HEADING TS_ACL_VAULT_DOC TS_ACL_VAULT_HEADING \
      NGINX_VAULT_DOC NGINX_VAULT_HEADING 2>/dev/null || true

# Repo bin first on $PATH (install dir stripped) and a clean git config — the
# PATH-vs-repo trap that gave false greens locally and red on CI (a tool shelled
# out by bare name, or the cross-repo `describe` federation, resolving to a stale
# installed copy), plus the leaking-global-git-config trap. One definition, in
# lib/common.sh.
ci_shell_env

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
diagram_bin() { "$TOOLS_HOME/bin/diagram" "$@"; }

tool_count() {
    local count=0 file
    for file in "$TOOLS_HOME"/bin/*; do
        [[ -f "$file" && -x "$file" ]] && count=$((count + 1))
    done
    printf '%s' "$count"
}
