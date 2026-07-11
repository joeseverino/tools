# shellcheck shell=bash

path_without() {
    local drop="$1" src="${2-$PATH}" out="" seg
    local IFS=':'
    for seg in $src; do
        [[ -z "$seg" || "$seg" == "$drop" ]] && continue
        out+="${out:+:}$seg"
    done
    printf '%s' "$out"
}

ci_shell_env() {
    : "${TOOLS_HOME:?ci_shell_env needs TOOLS_HOME}"
    local bin="${TOOLS_HOME%/}/bin" install="${TOOLS_INSTALL_DIR:-$HOME/.local/bin}"
    local rest
    rest="$(path_without "$install" "$(path_without "$bin")")"
    export PATH="$bin:$rest"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1
}
