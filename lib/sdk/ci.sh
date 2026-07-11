# shellcheck shell=bash
# CI parity — ONE definition of the hermetic, CI-equivalent shell environment,
# derived by both the bats harness (tests/helpers.bash) and `tools check --ci`
# (emit once, derive everywhere). Every local↔CI divergence that has bitten is
# neutralized here, once: a stale ~/.local/bin tool shadowing repo code on
# $PATH, and the operator's global/system git config (init.defaultBranch, host
# aliases, hooks) leaking into git operations.

# path_without <dir> [<path>] — echo <path> (default $PATH) with every segment
# equal to <dir> removed (empty segments dropped). Pure; no side effects.
path_without() {
    local drop="$1" src="${2-$PATH}" out="" seg
    local IFS=':'
    for seg in $src; do
        [[ -z "$seg" || "$seg" == "$drop" ]] && continue
        out+="${out:+:}$seg"
    done
    printf '%s' "$out"
}

# ci_shell_env — apply the CI-equivalent environment to the current shell.
#   PATH: this checkout's bin first, the install dir ($TOOLS_INSTALL_DIR,
#         default ~/.local/bin) removed — a stale installed symlink can never
#         shadow repo code. Idempotent: safe to call again in a child.
#   git:  empty global + system config so the operator's machine doesn't leak
#         (CI runs a clean config).
ci_shell_env() {
    : "${TOOLS_HOME:?ci_shell_env needs TOOLS_HOME}"
    local bin="${TOOLS_HOME%/}/bin" install="${TOOLS_INSTALL_DIR:-$HOME/.local/bin}"
    local rest
    rest="$(path_without "$install" "$(path_without "$bin")")"
    export PATH="$bin:$rest"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1
}
