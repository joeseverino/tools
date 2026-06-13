#!/usr/bin/env bats
# describe-tui.bats — the `tools describe --tui` explorer. Like site-manage.bats,
# DESCRIBE_TUI_SMOKE renders one static frame and DESCRIBE_TUI_KEYS replays keys
# through the real handler and prints the final frame; neither needs a TTY. No
# fixture is needed — the TUI shells out to the repo's own `tools describe`,
# which is deterministic.

load helpers

tui() { node "$TOOLS_HOME/lib/tools/describe-tui.mjs"; }

# ---- static renders ----------------------------------------------------------

@test "smoke: frame lists tools, the header, and the selected tool's commands" {
    export DESCRIBE_TUI_SMOKE=1
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"tools describe"* ]]
    [[ "$output" == *"TOOLS ("* ]]
    [[ "$output" == *"encrypt"* ]]
    [[ "$output" == *"site"* ]]
    [[ "$output" == *"COMMANDS"* ]]
}

@test "smoke: renders are byte-identical (deterministic, no timestamps)" {
    export DESCRIBE_TUI_SMOKE=1
    first="$(tui)"
    second="$(tui)"
    [ "$first" = "$second" ]
}

# ---- interactions ------------------------------------------------------------

@test "replay: down moves the tool selection" {
    export DESCRIBE_TUI_KEYS='down'
    run tui
    [ "$status" -eq 0 ]
    # The second tool in the contract-defined workflow is encrypt.
    selected="$(printf '%s\n' "$output" | grep -- '▸')"
    [[ "$selected" == *"encrypt"* ]]
}

@test "replay: Tab crosses focus into the command pane" {
    export DESCRIBE_TUI_KEYS='tab'
    run tui
    [ "$status" -eq 0 ]
    # tools' first command (status) now carries the ▸ cursor in the right pane.
    cursor_line="$(printf '%s\n' "$output" | grep -- '▸')"
    [[ "$cursor_line" == *"status"* ]]
}

@test "replay: / filters tools by a command name across the toolchain" {
    export DESCRIBE_TUI_KEYS='slash,p,u,b,l,i,s,h,enter'
    run tui
    [ "$status" -eq 0 ]
    # 'publish' lives on site's commands, not its name/description — the
    # cross-tool command search narrows the list to site.
    [[ "$output" == *"TOOLS (1)"* ]]
    [[ "$output" == *"site"* ]]
    [[ "$output" != *"adguard"* ]]
}

@test "replay: the focused command expands its own options/args inline" {
    # Filter to tools, drop into its command pane (status is first) — status's
    # --json flag (now structured in the spec) shows under it.
    export DESCRIBE_TUI_KEYS='slash,t,o,o,l,s,enter,down,down,enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"status"* ]]
    [[ "$output" == *"--json"* ]]
    [[ "$output" == *"Machine-readable output"* ]]
}

@test "replay: selected command detail is separate from the stable command list" {
    export DESCRIBE_TUI_COLUMNS=150
    export DESCRIBE_TUI_ROWS=32
    export DESCRIBE_TUI_KEYS='slash,s,i,t,e,enter,tab,down,down,down,down,down,down,down,down,down,down,down,down,down,down,down,down'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"SELECTED"* ]]
    [[ "$output" == *"featured"* ]]
    [[ "$output" == *"effect"*"vault_write"* ]]
    [[ "$output" == *"[slug]"* ]]
    [[ "$output" == *"copy"*"site featured [<slug>] [<target>]"* ]]
}

@test "replay: Enter on a command copies a ready-to-paste invocation" {
    export DESCRIBE_TUI_KEYS='tab,enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"copied: tools status"* ]]
}

@test "replay: Enter on a leaf tool copies the tool + positional placeholder" {
    # decrypt is a leaf tool (no subcommands) with a <file> positional.
    # First enter commits the filter (list = decrypt); second enter copies it.
    export DESCRIBE_TUI_KEYS='slash,d,e,c,r,y,p,t,enter,enter'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"copied: decrypt <file>"* ]]
}

@test "replay: e expands the selected scope into a full-screen detail overlay" {
    # The expand overlay surfaces the full prose + examples a command carries
    # in the contract, instead of truncating to a "-h" pointer. tools describe
    # carries examples (one of them the `tools tui` alias).
    export DESCRIBE_TUI_COLUMNS=100
    export DESCRIBE_TUI_ROWS=40
    export DESCRIBE_TUI_KEYS='slash,t,o,o,l,s,enter,tab,down,down,down,down,down,down,down,e'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"DETAIL"* ]]
    [[ "$output" == *"tools describe"* ]]
    [[ "$output" == *"EXAMPLES"* ]]
    [[ "$output" == *"e/esc back"* ]]
}

@test "replay: e then e closes the overlay back to the two-pane explorer" {
    export DESCRIBE_TUI_KEYS='tab,e,e'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" != *"DETAIL"* ]]
    [[ "$output" == *"switch pane"* ]]
}

@test "replay: esc clears an active filter back to every tool" {
    export DESCRIBE_TUI_KEYS='slash,s,i,t,e,enter,esc'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"TOOLS (18)"* ]]
}

@test "replay: short terminals keep the cursor and footer on screen" {
    export DESCRIBE_TUI_ROWS=10
    export DESCRIBE_TUI_KEYS='down,down,down,down,down'
    run tui
    [ "$status" -eq 0 ]
    [[ "$output" == *"▸"* ]]
    [[ "$output" == *"switch pane"* ]]
    [ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -le 10 ]
}

@test "describe --tui refuses without a terminal (points at --pretty)" {
    run node "$TOOLS_HOME/lib/tools/describe-tui.mjs"
    [ "$status" -eq 1 ]
    [[ "$output" == *"needs a terminal"* ]]
    [[ "$output" == *"--pretty"* ]]
}
