#!/usr/bin/env bats
# crypt.bats — encrypt/decrypt behavior with a throwaway key.

load helpers

setup() {
    setup_crypt
    cd "$BATS_TEST_TMPDIR"
    echo "the quick brown fox" > note.md
}

@test "encrypt removes the plaintext and creates .age" {
    run encrypt_bin note.md
    [ "$status" -eq 0 ]
    [ -f note.md.age ]
    [ ! -f note.md ]
}

@test "round trip: decrypt restores the exact content" {
    encrypt_bin note.md
    run decrypt_bin note.md.age
    [ "$status" -eq 0 ]
    [ -f note.md ]
    [ "$(cat note.md)" = "the quick brown fox" ]
}

@test "encrypt -c keeps the original" {
    run encrypt_bin -c note.md
    [ "$status" -eq 0 ]
    [ -f note.md ]
    [ -f note.md.age ]
}

@test "encrypt refuses to overwrite an existing .age without -f" {
    encrypt_bin -c note.md
    run encrypt_bin -c note.md
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped"* ]]
}

@test "decrypt refuses to overwrite existing plaintext without -f" {
    encrypt_bin -c note.md
    run decrypt_bin note.md.age
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped"* ]]
    [ "$(cat note.md)" = "the quick brown fox" ]
}

@test "decrypt -p writes plaintext to stdout, leaves no file" {
    encrypt_bin note.md
    run decrypt_bin -p note.md.age
    [ "$status" -eq 0 ]
    [ "$output" = "the quick brown fox" ]
    [ ! -f note.md ]
}

@test "decrypt skips non-.age files" {
    echo "plain" > plain.txt
    run decrypt_bin plain.txt
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped"* ]]
}

@test "decrypt fails cleanly on a corrupt .age file" {
    echo "not an age file" > broken.age
    run decrypt_bin broken.age
    [ "$status" -eq 1 ]
    [[ "$output" == *"failed"* ]]
}

@test "encrypt with no args is a usage error (exit 2)" {
    run encrypt_bin
    [ "$status" -eq 2 ]
}

@test "unknown flag is a usage error (exit 2)" {
    run encrypt_bin --bogus note.md
    [ "$status" -eq 2 ]
}

@test "encrypt -k adds a second recipient that can decrypt" {
    ssh-keygen -q -t ed25519 -N "" -C "second" -f "$BATS_TEST_TMPDIR/second"
    encrypt_bin -k "$BATS_TEST_TMPDIR/second.pub" note.md
    run decrypt_bin -p -k "$BATS_TEST_TMPDIR/second" note.md.age
    [ "$status" -eq 0 ]
    [ "$output" = "the quick brown fox" ]
}

@test "decrypt uses the cached passphrase silently (regression: cache was bypassed)" {
    # A passphrased key plus a stubbed Keychain that serves the passphrase.
    # osascript is stubbed to fail, so if decrypt falls through to the prompt
    # path — the ${NO_CACHE:+1} bug that always bypassed the cache — the
    # unlock dies instead of hanging a dialog.
    rm -f "$KEYS_HOME/file_key/file_key" "$KEYS_HOME/file_key/file_key.pub"
    ssh-keygen -q -t ed25519 -N "sekret" -C "tools-test" \
        -f "$KEYS_HOME/file_key/file_key"

    local stubs="$BATS_TEST_TMPDIR/stubs"
    mkdir -p "$stubs"
    cat > "$stubs/security" <<'STUB'
#!/usr/bin/env bash
case "$*" in
    *find-generic-password*-w*) echo "sekret" ;;
    *find-generic-password*)    : ;;
esac
STUB
    printf '#!/usr/bin/env bash\nexit 1\n' > "$stubs/osascript"
    chmod +x "$stubs/security" "$stubs/osascript"
    export KEY_SECURITY_BIN="$stubs/security"
    export PATH="$stubs:$PATH"

    encrypt_bin note.md
    run decrypt_bin note.md.age
    [ "$status" -eq 0 ]
    [ "$(cat note.md)" = "the quick brown fox" ]
}

@test "decrypt --no-cache skips the keychain and fails without a prompt source" {
    # Inverse guard: with --no-cache the stubbed Keychain must NOT be asked,
    # and with the prompt unavailable the unlock fails per-cause (exit 1,
    # "no passphrase" — the case $? branches used to be unreachable).
    rm -f "$KEYS_HOME/file_key/file_key" "$KEYS_HOME/file_key/file_key.pub"
    ssh-keygen -q -t ed25519 -N "sekret" -C "tools-test" \
        -f "$KEYS_HOME/file_key/file_key"

    local stubs="$BATS_TEST_TMPDIR/stubs"
    mkdir -p "$stubs"
    cat > "$stubs/security" <<'STUB'
#!/usr/bin/env bash
case "$*" in
    *find-generic-password*-w*) echo "sekret"; echo "asked" >> "${SECURITY_LOG:?}" ;;
esac
STUB
    printf '#!/usr/bin/env bash\nexit 1\n' > "$stubs/osascript"
    chmod +x "$stubs/security" "$stubs/osascript"
    export KEY_SECURITY_BIN="$stubs/security"
    export SECURITY_LOG="$BATS_TEST_TMPDIR/security.log"
    export PATH="$stubs:$PATH"

    encrypt_bin note.md
    run decrypt_bin --no-cache note.md.age
    [ "$status" -eq 1 ]
    [[ "$output" == *"no passphrase provided"* ]]
    [ ! -f "$SECURITY_LOG" ]
}
