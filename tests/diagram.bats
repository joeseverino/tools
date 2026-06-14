#!/usr/bin/env bats
# diagram.bats — Mermaid renderer behavior without downloading Mermaid CLI.

load helpers

setup() {
    mkdir -p "$BATS_TEST_TMPDIR/bin" "$BATS_TEST_TMPDIR/diagrams"
    mkdir -p "$BATS_TEST_TMPDIR/kit/web"
    export NPX_LOG="$BATS_TEST_TMPDIR/npx.log"
    export CONFIG_LOG="$BATS_TEST_TMPDIR/config.json"
    export DIAGRAM_BRAND_KIT="$BATS_TEST_TMPDIR/kit"
    export DIAGRAM_FONT="$BATS_TEST_TMPDIR/inter.woff2"
    export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
    printf 'fake font\n' > "$DIAGRAM_FONT"
    cat > "$DIAGRAM_BRAND_KIT/web/tokens.css" <<'EOF'
:root {
  --brand-accent: #123456;
  --brand-ink: #111111;
  --brand-paper: #ffffff;
}
EOF
    cat > "$BATS_TEST_TMPDIR/bin/npx" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NPX_LOG"
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i) src="$2"; shift 2 ;;
        -o) out="$2"; shift 2 ;;
        -c) cp "$2" "$CONFIG_LOG"; shift 2 ;;
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
    grep -q -- '-y -p @mermaid-js/mermaid-cli@11.15.0 mmdc -i one.mmd -o one.png -c .* -w 1100 -s 2 -b white' "$NPX_LOG"
    grep -q '"primaryBorderColor": "#123456"' "$CONFIG_LOG"
    grep -q '"theme": "base"' "$CONFIG_LOG"
    grep -q 'data:font/woff2;base64' "$CONFIG_LOG"
    grep -q '\\\"Inter\\\", sans-serif' "$CONFIG_LOG"
    grep -q 'edgeLabel p.*background: #ffffff' "$CONFIG_LOG"
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

@test "an incomplete brand kit fails clearly" {
    rm -f "$DIAGRAM_BRAND_KIT/web/tokens.css"
    printf 'flowchart LR\n' > "$BATS_TEST_TMPDIR/one.mmd"

    run "$TOOLS_HOME/bin/diagram" "$BATS_TEST_TMPDIR/one.mmd"

    [ "$status" -eq 1 ]
    [[ "$output" == *"brand tokens not found"* ]]
}
