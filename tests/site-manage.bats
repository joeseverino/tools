#!/usr/bin/env bats
# site-manage.bats — the site manage TUI against the fake MCP fixture.
# MANAGE_TUI_SMOKE renders one static frame; MANAGE_TUI_KEYS replays keys
# through the real handler and prints the final frame. Neither needs a TTY.

load helpers

setup() {
    setup_manage
}

tui() { node "$TOOLS_HOME/lib/site/manage-tui.mjs"; }

# ---- static renders ----------------------------------------------------------

@test "smoke: list frame shows featured order, divider, and the new row" {
    export MANAGE_TUI_SMOKE=1
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"FEATURED"* ]]
    [[ "$output" == *"alpha"* ]]
    [[ "$output" == *"not featured"* ]]
    [[ "$output" == *"new writeup…"* ]]
    [ "$(grep -c -- '^writeup-dashboard$' "$FAKE_MCP_LOG")" -eq 1 ]
}

@test "smoke: draft with real gate issues gets the ! mark, clean rows don't" {
    export MANAGE_TUI_SMOKE=1
    run tui
    # gamma keeps "missing image" after the expected draft blockers are filtered
    [[ "$output" == *"gamma"* ]]
    gamma_line="$(printf '%s\n' "$output" | grep gamma)"
    [[ "$gamma_line" == *"!"* ]]
    alpha_line="$(printf '%s\n' "$output" | grep 'alpha ')"
    [[ "$alpha_line" != *"!"* ]]
}

@test "smoke: site frame shows status, content counts, and actions" {
    export MANAGE_TUI_SMOKE=site
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"SYSTEM STATUS"* ]]
    [[ "$output" == *"CONTENT"* ]]
    [[ "$output" == *"2 published"* ]]
    [[ "$output" == *"1 draft not ready to publish"* ]]
    [[ "$output" == *"INTERACTIVE ACTIONS"* ]]
}

@test "smoke: detail fields keep long labels separated from their values" {
    export MANAGE_TUI_SMOKE=detail
    run tui
    [ "$status" -eq 0 ]
    related_line="$(printf '%s\n' "$output" | grep 'related_projects')"
    [[ "$related_line" == *"related_projects  "* ]]
    [[ "$related_line" == *"edit in Obsidian"* ]]
    [[ "$related_line" != *"related_projectsadguard"* ]]
}

# ---- interactions ------------------------------------------------------------

@test "replay: right arrow lands on the Site tab" {
    export MANAGE_TUI_KEYS='right'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"SYSTEM STATUS"* ]]
}

@test "replay: left arrow returns to the Writeups tab" {
    export MANAGE_TUI_KEYS='right,left'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"FEATURED"* ]]
}

@test "replay: enter opens the detail view for the selected writeup" {
    export MANAGE_TUI_KEYS='enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"Alpha Writeup"* ]]
    [[ "$output" == *"published_at"* ]]
}

@test "replay: split left-arrow edits at the cursor instead of typing [D" {
    export MANAGE_TUI_KEYS='enter,enter,left-prefix,left-suffix,X,enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"Alpha WriteuXp"* ]]
    [[ "$output" != *"[D"* ]]
}

@test "replay: long field editor keeps the cursor visible in a narrow terminal" {
    export MANAGE_TUI_COLUMNS=54
    export MANAGE_TUI_KEYS='enter,down,enter,abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz'
    run tui
    [ "$status" -eq 0 ]
    description_line="$(printf '%s\n' "$output" | grep '^.*description')"
    [[ "$description_line" == *"…"* ]]
    [[ "$description_line" == *$'\033[7m '* ]]
}

@test "replay: Unicode cursor movement and backspace operate on graphemes" {
    export MANAGE_TUI_KEYS='enter,enter,ctrl-u,paste:café🙂,left,backspace,enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"caf🙂"* ]]
    [[ "$output" != *"café🙂"* ]]
}

@test "replay: bracketed paste inserts text atomically and flattens newlines" {
    export MANAGE_TUI_KEYS=$'enter,down,enter,paste:first line\nsecond line,enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"first line second line"* ]]
}

@test "replay: short terminals keep the selected row and footer visible" {
    export MANAGE_TUI_ROWS=10
    export MANAGE_TUI_KEYS='down,down'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"▸"* ]]
    [[ "$output" == *"↑/↓ select"* ]]
    [ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -le 10 ]
}

@test "replay: left and right arrows still switch tabs outside line editing" {
    export MANAGE_TUI_KEYS='right,left'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"FEATURED"* ]]
}

@test "replay: p stages a publish flip and the save hint appears" {
    export MANAGE_TUI_KEYS='p'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"will unpublish"* ]]
    [[ "$output" == *"press s to save"* ]]
    [[ "$output" == *"s save"* ]]
}

@test "replay: space + down moves alpha below beta in the featured order" {
    export MANAGE_TUI_KEYS='space,down,space'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"staged: featured order"* ]]
    beta_line="$(printf '%s\n' "$output" | grep -n 'beta' | head -1 | cut -d: -f1)"
    alpha_line="$(printf '%s\n' "$output" | grep -n 'alpha' | head -1 | cut -d: -f1)"
    [ "$beta_line" -lt "$alpha_line" ]
}

@test "replay: q with staged changes asks before quitting" {
    export MANAGE_TUI_KEYS='p,q'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"unsaved changes"* ]]
}

@test "replay: q with nothing staged quits without writing" {
    export MANAGE_TUI_KEYS='q'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"cancelled — nothing written"* ]]
}

@test "replay: p,s saves the flip through the MCP code path" {
    export MANAGE_TUI_KEYS='p,s'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"alpha: unpublish"* ]]
    [[ "$output" == *"saved"* ]]
    grep -q -- 'apply-writeup-plan.*"slug":"alpha".*"published":false' "$FAKE_MCP_LOG"
}

@test "replay: unfeaturing via f submits the complete featured order once" {
    export MANAGE_TUI_KEYS='f,s'
    run tui
    [ "$status" -eq 0 ]
    [ "$(grep -c -- 'apply-writeup-plan' "$FAKE_MCP_LOG")" -eq 1 ]
    grep -q -- '"featured_order":\["beta"\]' "$FAKE_MCP_LOG"
}

@test "PTY: interactive terminal handles resize-sized frames, paste, and split arrows" {
    [ -x /usr/bin/expect ] || skip "macOS expect is unavailable"
    export NODE_BIN
    NODE_BIN="$(command -v node)"
    export TUI_BIN="$TOOLS_HOME/lib/site/manage-tui.mjs"
    run /usr/bin/expect "$TOOLS_HOME/tests/site-manage-pty.exp"
    [ "$status" -eq 0 ]
    [[ "$output" == *$'\033[?1049h'* ]]
    [[ "$output" == *$'\033[?2004h'* ]]
    [[ "$output" == *$'\033[?2004l'* ]]
    [[ "$output" == *"PTY pasted titlXe"* ]]
}
