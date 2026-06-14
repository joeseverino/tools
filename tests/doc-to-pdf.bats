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
    printf '# Artifact Title\n\n%s\n' "$(yes 'Branded document body.' | head -80)" > "$input"
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

    run env HOME="$home" DOCTOPDF_BRAND_KIT="$kit" DOCTOPDF_KEEP_HTML=1 \
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
    printf 'Document body without a heading.\n' > "$input"
    cat > "$chrome" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
    case "$arg" in
        --print-to-pdf=*) printf 'fake pdf\n' > "${arg#--print-to-pdf=}" ;;
    esac
done
EOF
    chmod +x "$chrome"

    run env CHROME_PATH="$chrome" DOCTOPDF_BRAND_KIT="$kit" DOCTOPDF_KEEP_HTML=1 \
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

    run env DOCTOPDF_BRAND_KIT="$BATS_TEST_TMPDIR/missing" \
        "$TOOLS_HOME/bin/doc-to-pdf" "$input" "$BATS_TEST_TMPDIR/output.pdf"
    [ "$status" -eq 1 ]
    [[ "$output" == *"brand tokens not found"* ]]
}
