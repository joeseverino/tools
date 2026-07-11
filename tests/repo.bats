#!/usr/bin/env bats
# repo.bats — the fleet-entry verb. Hermetic: a fake cordon-starter tree,
# stubbed gh/hq on PATH (call-logging), CODE_HOME/NOTES_HOME in the sandbox.

load helpers

setup() {
    export CODE_HOME="$BATS_TEST_TMPDIR/code"
    export NOTES_HOME="$BATS_TEST_TMPDIR/vault"
    mkdir -p "$CODE_HOME/Assets" "$CODE_HOME/Projects" "$NOTES_HOME/01 Projects"

    # Commits inside the bootstrapped repo need an identity; ci_shell_env
    # points GIT_CONFIG_GLOBAL at /dev/null, so give the sandbox its own.
    export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/gitconfig"
    git config --file "$GIT_CONFIG_GLOBAL" user.name "tools-test"
    git config --file "$GIT_CONFIG_GLOBAL" user.email "tools-test@localhost"

    # gh / hq stubs: record the call, succeed.
    export STUB_LOG="$BATS_TEST_TMPDIR/stub-calls.log"
    mkdir -p "$BATS_TEST_TMPDIR/stubs"
    for stub in gh hq; do
        printf '#!/usr/bin/env bash\necho "%s $*" >> "$STUB_LOG"\n' "$stub" \
            > "$BATS_TEST_TMPDIR/stubs/$stub"
        chmod +x "$BATS_TEST_TMPDIR/stubs/$stub"
    done
    export PATH="$BATS_TEST_TMPDIR/stubs:$PATH"

    # A minimal but faithful starter tree: both emitter tracks, goldens,
    # the scripts the bootstrap invokes, and a stray .git that must not copy.
    export STARTER_HOME="$BATS_TEST_TMPDIR/starter"
    mkdir -p "$STARTER_HOME"/{bin,contract,scripts,.githooks,.git}
    cat > "$STARTER_HOME/bin/example-tool" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == "--describe" ]] && { echo '{"tool":"example-tool"}'; exit 0; }
EOF
    printf '// example-node emitter\n' > "$STARTER_HOME/bin/example-node"
    chmod +x "$STARTER_HOME/bin/example-tool" "$STARTER_HOME/bin/example-node"
    echo '{}' > "$STARTER_HOME/contract/example-tool.json"
    echo '{}' > "$STARTER_HOME/contract/example-node.json"
    printf '{\n  "name": "example-node"\n}\n' > "$STARTER_HOME/package.json"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$STARTER_HOME/scripts/check.sh"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$STARTER_HOME/scripts/setup-hooks.sh"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$STARTER_HOME/scripts/setup-governance.sh"
    chmod +x "$STARTER_HOME"/scripts/*.sh
    echo "starter" > "$STARTER_HOME/README.md"
    echo "MIT" > "$STARTER_HOME/LICENSE"
}

@test "repo -h renders help with no environment" {
    unset CODE_HOME NOTES_HOME STARTER_HOME
    run repo -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"front door"* ]]
}

@test "repo --describe emits the contract" {
    run repo --describe
    [ "$status" -eq 0 ]
    [[ "$output" == *'"repo"'* ]]
    [[ "$output" == *'"remote_write"'* ]]
}

@test "repo with no command dies with usage" {
    run repo
    [ "$status" -eq 2 ]
    [[ "$output" == *"new or register"* ]]
}

@test "repo new rejects a non-kebab slug" {
    run repo new Bad_Slug
    [ "$status" -eq 2 ]
    [[ "$output" == *"kebab-case"* ]]
}

@test "repo new bootstraps, keeps the bash track, and registers" {
    run repo new demo-tool --description "A demo."
    [ "$status" -eq 0 ]

    dest="$CODE_HOME/Projects/demo-tool"
    [ -d "$dest" ]
    [ -x "$dest/bin/demo-tool" ]                       # renamed track
    [ ! -e "$dest/bin/example-node" ]                  # other track pruned
    [ ! -e "$dest/contract/example-node.json" ]
    [ ! -e "$dest/contract/example-tool.json" ]        # stale golden gone
    [ ! -e "$dest/package.json" ]                      # bash track drops it
    [ -s "$dest/contract/demo-tool.json" ]             # regenerated golden

    # Fresh history: exactly one commit, on main, not the starter's .git.
    [ "$(git -C "$dest" rev-list --count HEAD)" = "1" ]
    [ "$(git -C "$dest" branch --show-current)" = "main" ]

    # Registration: vault doc + HQ create + sync, GitHub created.
    index="$NOTES_HOME/01 Projects/demo-tool/index.md"
    [ -f "$index" ]
    grep -q "doc_id: project-demo-tool" "$index"
    grep -q "A demo." "$index"
    grep -q "gh repo create demo-tool --private --source=. --push" "$STUB_LOG"
    grep -q "hq create project demo-tool --name Demo Tool" "$STUB_LOG"
    grep -q "hq sync" "$STUB_LOG"
}

@test "repo new --track node keeps the node track and package.json" {
    run repo new demo-node --track node --local --no-register
    [ "$status" -eq 0 ]
    dest="$CODE_HOME/Projects/demo-node"
    [ -f "$dest/bin/demo-node" ]
    [ ! -e "$dest/bin/example-tool" ]
    [ -f "$dest/package.json" ]
    grep -q '"demo-node"' "$dest/package.json"         # identifier renamed
}

@test "repo new --local --no-register touches neither gh nor hq" {
    run repo new offline-tool --local --no-register
    [ "$status" -eq 0 ]
    [ -d "$CODE_HOME/Projects/offline-tool" ]
    [ ! -f "$STUB_LOG" ]
    [ ! -e "$NOTES_HOME/01 Projects/offline-tool" ]
}

@test "repo new --root assets lands under Assets/" {
    run repo new asset-tool --root assets --local --no-register
    [ "$status" -eq 0 ]
    [ -d "$CODE_HOME/Assets/asset-tool" ]
}

@test "repo new refuses an existing destination" {
    mkdir -p "$CODE_HOME/Projects/taken"
    run repo new taken
    [ "$status" -eq 1 ]
    [[ "$output" == *"already exists"* ]]
}

@test "repo new --dry-run creates nothing" {
    run repo new ghost --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"dry-run"* ]]
    [ ! -e "$CODE_HOME/Projects/ghost" ]
    [ ! -f "$STUB_LOG" ]
}

@test "repo register backfills an existing repo" {
    dir="$CODE_HOME/Assets/oldie"
    mkdir -p "$dir"
    git -C "$dir" init -qb main
    git -C "$dir" remote add origin git@github.com:joeseverino/oldie.git

    run repo register oldie --category automation --description "Backfilled."
    [ "$status" -eq 0 ]

    index="$NOTES_HOME/01 Projects/oldie/index.md"
    [ -f "$index" ]
    grep -q "doc_id: project-oldie" "$index"
    grep -q "hq create project oldie" "$STUB_LOG"
    grep -q -- "--repo https://github.com/joeseverino/oldie" "$STUB_LOG"
    grep -q "hq sync" "$STUB_LOG"
}

@test "repo register keeps an existing vault doc" {
    dir="$CODE_HOME/Projects/kept"
    mkdir -p "$dir" "$NOTES_HOME/01 Projects/kept"
    echo "original" > "$NOTES_HOME/01 Projects/kept/index.md"
    run repo register kept
    [ "$status" -eq 0 ]
    [[ "$output" == *"kept"* ]]
    [ "$(cat "$NOTES_HOME/01 Projects/kept/index.md")" = "original" ]
}

@test "repo register dies when the repo is nowhere on disk" {
    run repo register missing-repo
    [ "$status" -eq 1 ]
    [[ "$output" == *"no repo at"* ]]
}
