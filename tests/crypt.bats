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
