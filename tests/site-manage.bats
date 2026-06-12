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
