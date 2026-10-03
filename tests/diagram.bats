#!/usr/bin/env bats
# diagram.bats — Mermaid renderer behavior with the CLI and browser stubbed.

load helpers

setup() {
    mkdir -p "$BATS_TEST_TMPDIR/bin" "$BATS_TEST_TMPDIR/diagrams"
    mkdir -p "$BATS_TEST_TMPDIR/kit/web"
    export MMDC_LOG="$BATS_TEST_TMPDIR/mmdc.log"
    export CONFIG_LOG="$BATS_TEST_TMPDIR/config.json"
    export DIAGRAM_BRAND_KIT="$BATS_TEST_TMPDIR/kit"
    export DIAGRAM_FONT="$BATS_TEST_TMPDIR/inter.woff2"
    export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
    printf 'fake font\n' > "$DIAGRAM_FONT"
    cat > "$DIAGRAM_BRAND_KIT/web/tokens.css" <<'EOF'
:root {
  --brand-accent: #123456;
  --brand-deep: #0a1a2b;
  --brand-on-accent: #ffffff;
  --brand-ink: #111111;
  --brand-paper: #ffffff;
}
EOF
    export MMDC_BIN="$BATS_TEST_TMPDIR/bin/mmdc"
    export DIAGRAM_CHROMIUM="$MMDC_BIN"
    cat > "$MMDC_BIN" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MMDC_LOG"
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
    chmod +x "$MMDC_BIN"
}

@test "directory input renders each top-level mmd with the established settings" {
    printf 'flowchart LR\n' > "$BATS_TEST_TMPDIR/diagrams/one.mmd"
    printf 'flowchart TD\n' > "$BATS_TEST_TMPDIR/diagrams/two.mmd"

    run "$TOOLS_HOME/bin/diagram" "$BATS_TEST_TMPDIR/diagrams"

    [ "$status" -eq 0 ]
    [ -f "$BATS_TEST_TMPDIR/diagrams/one.png" ]
    [ -f "$BATS_TEST_TMPDIR/diagrams/two.png" ]
    [ "$(wc -l < "$MMDC_LOG" | tr -d ' ')" -eq 2 ]
    grep -q -- '-i one.mmd -o one.png -c .* -p .* -w 1100 -s 3 -b white' "$MMDC_LOG"
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
