#!/usr/bin/env bats

load helpers

setup() {
    export NOTES_HOME="$BATS_TEST_TMPDIR/vault"
    export VAULT="$NOTES_HOME"
    export INBOX_DIR="$VAULT/00 Inbox"
    mkdir -p "$INBOX_DIR"
}

@test "inbox writes standardized doc_id and created frontmatter" {
    run "$TOOLS_HOME/bin/inbox" "remember the milk"
    [ "$status" -eq 0 ]

    note_count=$(find "$INBOX_DIR" -maxdepth 1 -type f -name "*.md" | wc -l | tr -d ' ')
    [ "$note_count" -eq 1 ]

    note=$(find "$INBOX_DIR" -maxdepth 1 -type f -name "*.md" -print)
    [[ "$(basename "$note")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{6}\ remember\ the\ milk\.md$ ]]

    run sed -n '1,6p' "$note"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^---$'\n'doc_id:\ inbox-[0-9]{8}-[0-9]{6}$'\n'created:\ [0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$'\n'---$'\n'$'\n'remember\ the\ milk$ ]]
}
