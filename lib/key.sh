# shellcheck shell=bash
# shellcheck disable=SC2034  # AGE_IDENTITY is set here, read by callers (decrypt)
# key.sh — SSH passphrase cache (macOS Keychain) + age private-key unlock.
# Sourced by tools that need keychain access (decrypt, tools key).
#
# Storage: /usr/bin/security generic-password under service "age-key-passphrase".
# Access: -A (any app), same model git-credential-osxkeychain uses. The threat
# model is "anyone running as you can read it" — identical to a 600 file.
#
# Functions:
#   key_has               True if a cached passphrase exists.
#   key_get               Echo the cached passphrase (empty if none).
#   key_store <pass>      Store/replace the cached passphrase.
#   key_forget            Delete the cached passphrase.
#   key_prompt            Prompt user (TTY → read -s, no TTY → osascript).
#   key_validate <pass>   True if <pass> unlocks $AGE_KEY.
#   is_ssh_passphrased <file>
#                         True if file is a passphrase-protected OpenSSH key.
#   unlock_age_key [no_cache]
#                         Resolve $AGE_KEY to a usable identity file. On success
#                         sets $AGE_IDENTITY (and $UNLOCKED_KEY when a temp copy
#                         was made — the caller must remove it via trap).
#                         Returns 0 ok, 1 no passphrase, 2 wrong passphrase,
#                         3 $AGE_KEY missing.

KEY_SERVICE="age-key-passphrase"
KEY_ACCOUNT="${USER}"

UNLOCKED_KEY=""
AGE_IDENTITY=""

key_has() {
    /usr/bin/security find-generic-password \
        -a "$KEY_ACCOUNT" -s "$KEY_SERVICE" >/dev/null 2>&1
}

key_get() {
    /usr/bin/security find-generic-password \
        -a "$KEY_ACCOUNT" -s "$KEY_SERVICE" -w 2>/dev/null
}

key_store() {
    /usr/bin/security add-generic-password \
        -a "$KEY_ACCOUNT" -s "$KEY_SERVICE" \
        -l "age key passphrase ($KEY_ACCOUNT)" \
        -j "SSH passphrase for age private key (managed by tools/key)" \
        -w "$1" -U -A >/dev/null
}

key_forget() {
    /usr/bin/security delete-generic-password \
        -a "$KEY_ACCOUNT" -s "$KEY_SERVICE" >/dev/null 2>&1
}

key_prompt() {
    if [[ -t 0 && -t 1 ]]; then
        local pass
        printf 'Passphrase for %s: ' "${AGE_KEY:-age key}" >&2
        IFS= read -rs pass
        echo >&2
        printf '%s' "$pass"
    else
        osascript \
            -e 'display dialog "Enter the passphrase for your age private key:" default answer "" with hidden answer with title "age key"' \
            -e 'return text returned of result' 2>/dev/null
    fi
}

is_ssh_passphrased() {
    [[ -f "$1" ]] || return 1
    head -1 "$1" 2>/dev/null | grep -q '^-----BEGIN OPENSSH PRIVATE KEY-----' || return 1
    ! ssh-keygen -y -P "" -f "$1" >/dev/null 2>&1
}

key_validate() {
    local pass="$1" tmp
    [[ -f "${AGE_KEY:-}" ]] || return 2
    tmp=$(mktemp) || return 2
    cp "$AGE_KEY" "$tmp"
    chmod 600 "$tmp"
    if ssh-keygen -p -P "$pass" -N "" -f "$tmp" >/dev/null 2>&1; then
        rm -f "$tmp"
        return 0
    fi
    rm -f "$tmp"
    return 1
}

unlock_age_key() {
    local no_cache="${1-}"
    AGE_IDENTITY=""
    [[ -f "${AGE_KEY:-}" ]] || return 3
    if ! is_ssh_passphrased "$AGE_KEY"; then
        AGE_IDENTITY="$AGE_KEY"
        return 0
    fi
    local pass=""
    if [[ -z "$no_cache" ]]; then
        pass="$(key_get || true)"
    fi
    if [[ -z "$pass" ]]; then
        pass="$(key_prompt)"
        [[ -n "$pass" ]] || return 1
    fi
    UNLOCKED_KEY=$(mktemp -t age-key.XXXXXX)
    chmod 600 "$UNLOCKED_KEY"
    cp "$AGE_KEY" "$UNLOCKED_KEY"
    if ! ssh-keygen -p -P "$pass" -N "" -f "$UNLOCKED_KEY" >/dev/null 2>&1; then
        rm -f "$UNLOCKED_KEY"
        UNLOCKED_KEY=""
        return 2
    fi
    AGE_IDENTITY="$UNLOCKED_KEY"
    return 0
}
