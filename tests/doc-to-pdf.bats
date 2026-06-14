#!/usr/bin/env bats

load helpers

@test "doc-to-pdf emits a self-contained branded artifact" {
    local kit="$BATS_TEST_TMPDIR/kit"
    mkdir -p "$kit/web" "$kit/mark" "$kit/wordmark"
    cat > "$kit/web/tokens.css" <<'EOF'
:root {
  --brand-accent: #123456;
  --brand-deep: #102030;
  --brand-on-accent: #ffffff;
  --brand-ink: #111111;
  --brand-paper: #ffffff;
}
EOF
    printf '%s\n' '<svg data-test="mark" xmlns="http://www.w3.org/2000/svg"/>' > "$kit/mark/mark.svg"
    printf '%s\n' '<svg data-test="wordmark" xmlns="http://www.w3.org/2000/svg"/>' > "$kit/wordmark/wordmark-caps.svg"

    local input="$BATS_TEST_TMPDIR/source document.md"
    local pdf="$BATS_TEST_TMPDIR/source document.pdf"
    local home="$BATS_TEST_TMPDIR/home"
    local chrome="$home/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    local font="$BATS_TEST_TMPDIR/inter.woff2"
    {
        printf '# Artifact Title\n\n'
        printf 'A contract (*is this shippable?*)\n\n'
        printf '```jsonc\n{ "effect": "read", "network": true } // deterministic\n```\n\n'
        yes 'Branded document body.' | head -80
    } > "$input"
    printf 'fake font\n' > "$font"
    mkdir -p "$(dirname "$chrome")"
    cat > "$chrome" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
    case "$arg" in
        --print-to-pdf=*) printf 'fake pdf\n' > "${arg#--print-to-pdf=}" ;;
    esac
done
EOF
    chmod +x "$chrome"

    run env HOME="$home" DOCTOPDF_BRAND_KIT="$kit" DOCTOPDF_FONT="$font" DOCTOPDF_KEEP_HTML=1 \
        "$TOOLS_HOME/bin/doc-to-pdf" "$input" "$pdf"
    [ "$status" -eq 0 ]
    [ -s "$pdf" ]

    local html
    html="$(printf '%s\n' "$output" | sed -n 's/^doc-to-pdf: kept HTML at //p' | head -1)"
    [ -f "$html" ]
    grep -q -- '--brand-accent: #123456' "$html"
    grep -q 'data-test="mark"' "$html"
    grep -q 'data:image/svg+xml;base64' "$html"
    grep -q 'source document.md' "$html"
    grep -q 'counter(page).*counter(pages)' "$html"
    grep -q '<title>source document</title>' "$html"
    grep -q 'font-family: "Inter"' "$html"
    grep -q 'data:font/woff2;base64' "$html"
    grep -q 'white-space: pre-wrap' "$html"
    grep -q 'class="parenthetical"' "$html"
    grep -q 'em { font-family: Arial, Helvetica, sans-serif; font-style: italic; }' "$html"
    grep -q 'hr { border: 0; height: 0;' "$html"
    grep -q 'color: var(--brand-deep)' "$html"
    grep -q 'pre code { color: var(--brand-ink)' "$html"
    grep -q 'background: var(--brand-paper)' "$html"
    grep -q 'hljs-attr' "$html"
    grep -q 'hljs-comment' "$html"
    rm -f "$html"
}

@test "doc-to-pdf delegates inline Mermaid rendering to diagram" {
    local kit="$BATS_TEST_TMPDIR/kit"
    local bin="$BATS_TEST_TMPDIR/bin"
    local input="$BATS_TEST_TMPDIR/inline.md"
    local pdf="$BATS_TEST_TMPDIR/inline.pdf"
    local chrome="$BATS_TEST_TMPDIR/chrome"
    local font="$BATS_TEST_TMPDIR/inter.woff2"
    local npx_log="$BATS_TEST_TMPDIR/npx.log"
    mkdir -p "$kit/web" "$kit/mark" "$kit/wordmark" "$bin"
    cat > "$kit/web/tokens.css" <<'EOF'
:root {
  --brand-accent: #123456;
  --brand-deep: #102030;
  --brand-on-accent: #ffffff;
  --brand-ink: #111111;
  --brand-paper: #ffffff;
}
EOF
    printf '<svg xmlns="http://www.w3.org/2000/svg"/>\n' > "$kit/mark/mark.svg"
    printf '<svg xmlns="http://www.w3.org/2000/svg"/>\n' > "$kit/wordmark/wordmark-caps.svg"
    printf 'fake font\n' > "$font"
    cat > "$input" <<'EOF'
# Inline diagram

```mermaid
flowchart LR
    a --> b
```
EOF
    cat > "$bin/npx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NPX_LOG"
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        *) shift ;;
    esac
done
printf 'fake png\n' > "$out"
EOF
    cat > "$chrome" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
    case "$arg" in
        --print-to-pdf=*) printf 'fake pdf\n' > "${arg#--print-to-pdf=}" ;;
    esac
done
EOF
    chmod +x "$bin/npx" "$chrome"

    run env PATH="$bin:$PATH" NPX_LOG="$npx_log" CHROME_PATH="$chrome" \
        DOCTOPDF_BRAND_KIT="$kit" DOCTOPDF_FONT="$font" DOCTOPDF_KEEP_HTML=1 \
        "$TOOLS_HOME/bin/doc-to-pdf" "$input" "$pdf"

    [ "$status" -eq 0 ]
    grep -q '@mermaid-js/mermaid-cli@11.15.0 mmdc' "$npx_log"
    local html
    html="$(printf '%s\n' "$output" | sed -n 's/^doc-to-pdf: kept HTML at //p' | head -1)"
    grep -q 'class="mermaid-diagram"' "$html"
    grep -q 'data:image/png;base64' "$html"
    ! grep -q 'mermaid.initialize' "$html"
    rm -f "$html"
}

@test "doc-to-pdf supplies a branded title when Markdown has no h1" {
    local kit="$BATS_TEST_TMPDIR/kit"
    mkdir -p "$kit/web" "$kit/mark" "$kit/wordmark"
    printf ':root { --brand-accent: #123456; --brand-ink: #111; --brand-paper: #fff; }\n' > "$kit/web/tokens.css"
    printf '%s\n' '<svg data-test="mark" xmlns="http://www.w3.org/2000/svg"/>' > "$kit/mark/mark.svg"
    printf '%s\n' '<svg xmlns="http://www.w3.org/2000/svg"/>' > "$kit/wordmark/wordmark-caps.svg"

    local input="$BATS_TEST_TMPDIR/untitled artifact.md"
    local pdf="$BATS_TEST_TMPDIR/untitled artifact.pdf"
    local chrome="$BATS_TEST_TMPDIR/chrome"
    local font="$BATS_TEST_TMPDIR/inter.woff2"
    printf 'Document body without a heading.\n' > "$input"
    printf 'fake font\n' > "$font"
    cat > "$chrome" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
    case "$arg" in
        --print-to-pdf=*) printf 'fake pdf\n' > "${arg#--print-to-pdf=}" ;;
    esac
done
EOF
    chmod +x "$chrome"

    run env CHROME_PATH="$chrome" DOCTOPDF_BRAND_KIT="$kit" DOCTOPDF_FONT="$font" DOCTOPDF_KEEP_HTML=1 \
        "$TOOLS_HOME/bin/doc-to-pdf" "$input" "$pdf"
    [ "$status" -eq 0 ]

    local html
    html="$(printf '%s\n' "$output" | sed -n 's/^doc-to-pdf: kept HTML at //p' | head -1)"
    grep -q '<span>untitled artifact</span>' "$html"
    grep -q 'data-test="mark"' "$html"
    rm -f "$html"
}

@test "doc-to-pdf reports an incomplete brand kit clearly" {
    local input="$BATS_TEST_TMPDIR/source.md"
    printf '# Artifact\n' > "$input"

    run env DOCTOPDF_BRAND_KIT="$BATS_TEST_TMPDIR/missing" DOCTOPDF_FONT="$BATS_TEST_TMPDIR/missing.woff2" \
        "$TOOLS_HOME/bin/doc-to-pdf" "$input" "$BATS_TEST_TMPDIR/output.pdf"
    [ "$status" -eq 1 ]
    [[ "$output" == *"brand tokens not found"* ]]
}
