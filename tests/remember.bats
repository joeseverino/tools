#!/usr/bin/env bats
# remember.bats — memory file + MEMORY.md index behavior.

load helpers

setup() {
    setup_memory
}

@test "write creates the memory file with frontmatter and indexes it" {
    run remember_bin feedback test-rule "Test rule" \
        -d "a description" -k "the hook" -b "rule body" --dir "$MEMORY_DIR"
    [ "$status" -eq 0 ]
    [ -f "$MEMORY_DIR/feedback_test_rule.md" ]
    grep -q "name: feedback-test-rule" "$MEMORY_DIR/feedback_test_rule.md"
    grep -q 'description: "a description"' "$MEMORY_DIR/feedback_test_rule.md"
    grep -q "rule body" "$MEMORY_DIR/feedback_test_rule.md"
    grep -q -- "- \[Test rule\](feedback_test_rule.md) — the hook" "$MEMORY_DIR/MEMORY.md"
}

@test "body can come from stdin" {
    echo "stdin body" | remember_bin project from-stdin "From stdin" --dir "$MEMORY_DIR"
    grep -q "stdin body" "$MEMORY_DIR/project_from_stdin.md"
}

@test "duplicate slug without --force fails" {
    remember_bin user dupe "Dupe" -b "one" --dir "$MEMORY_DIR"
    run remember_bin user dupe "Dupe" -b "two" --dir "$MEMORY_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"--force"* ]]
    grep -q "one" "$MEMORY_DIR/user_dupe.md"
}

@test "--force updates in place without duplicating the index line" {
    remember_bin user dupe "Dupe" -b "one" --dir "$MEMORY_DIR"
    run remember_bin user dupe "Dupe v2" -b "two" -F --dir "$MEMORY_DIR"
    [ "$status" -eq 0 ]
    grep -q "two" "$MEMORY_DIR/user_dupe.md"
    [ "$(grep -c "(user_dupe.md)" "$MEMORY_DIR/MEMORY.md")" -eq 1 ]
    grep -q "Dupe v2" "$MEMORY_DIR/MEMORY.md"
}

@test "--forget removes the file and its index line, keeps others" {
    remember_bin user keep "Keep" -b "keep me" --dir "$MEMORY_DIR"
    remember_bin user gone "Gone" -b "forget me" --dir "$MEMORY_DIR"
    run remember_bin --forget gone --dir "$MEMORY_DIR"
    [ "$status" -eq 0 ]
    [ ! -f "$MEMORY_DIR/user_gone.md" ]
    [ -f "$MEMORY_DIR/user_keep.md" ]
    ! grep -q "user_gone.md" "$MEMORY_DIR/MEMORY.md"
    grep -q "user_keep.md" "$MEMORY_DIR/MEMORY.md"
}

@test "--list prints the index" {
    remember_bin reference some-doc "Some doc" -b "body" --dir "$MEMORY_DIR"
    run remember_bin --list --dir "$MEMORY_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Some doc"* ]]
}

@test "invalid type is a usage error (exit 2)" {
    run remember_bin bogus slug "Title" -b "body" --dir "$MEMORY_DIR"
    [ "$status" -eq 2 ]
}

@test "missing memory dir is a clean error" {
    run remember_bin user x "X" -b "body" --dir "$BATS_TEST_TMPDIR/nope"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* ]]
}
