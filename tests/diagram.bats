#!/usr/bin/env bats
# diagram.bats — Mermaid renderer behavior without downloading Mermaid CLI.

load helpers

setup() {
    mkdir -p "$BATS_TEST_TMPDIR/bin" "$BATS_TEST_TMPDIR/diagrams"
    export NPX_LOG="$BATS_TEST_TMPDIR/npx.log"
    export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
    cat > "$BATS_TEST_TMPDIR/bin/npx" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NPX_LOG"
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i) src="$2"; shift 2 ;;
        -o) out="$2"; shift 2 ;;
        *) shift ;;
    esac
done
printf 'rendered from %s\n' "$src" > "$out"
STUB
    chmod +x "$BATS_TEST_TMPDIR/bin/npx"
}

@test "directory input renders each top-level mmd with the established settings" {
    printf 'flowchart LR\n' > "$BATS_TEST_TMPDIR/diagrams/one.mmd"
    printf 'flowchart TD\n' > "$BATS_TEST_TMPDIR/diagrams/two.mmd"

    run "$TOOLS_HOME/bin/diagram" "$BATS_TEST_TMPDIR/diagrams"

    [ "$status" -eq 0 ]
    [ -f "$BATS_TEST_TMPDIR/diagrams/one.png" ]
    [ -f "$BATS_TEST_TMPDIR/diagrams/two.png" ]
    [ "$(wc -l < "$NPX_LOG" | tr -d ' ')" -eq 2 ]
    grep -q -- '-y -p @mermaid-js/mermaid-cli@11.15.0 mmdc -i one.mmd -o one.png -w 1100 -s 2 -b white' "$NPX_LOG"
}

@test "file input writes the neighboring png" {
    printf 'flowchart LR\n' > "$BATS_TEST_TMPDIR/one.mmd"

    run "$TOOLS_HOME/bin/diagram" "$BATS_TEST_TMPDIR/one.mmd"

    [ "$status" -eq 0 ]
    [ -f "$BATS_TEST_TMPDIR/one.png" ]
}

@test "an empty directory fails cleanly" {
    run "$TOOLS_HOME/bin/diagram" "$BATS_TEST_TMPDIR"

    [ "$status" -eq 1 ]
    [[ "$output" == *"no .mmd files found"* ]]
}
