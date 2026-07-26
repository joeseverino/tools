#!/usr/bin/env bats
# secrets.bats — hermetic contract for the single 1Password boundary.

load helpers

setup() {
    SECRETS_DIR="$BATS_TEST_TMPDIR/secrets"
    mkdir -p "$SECRETS_DIR/bin"
    export TOOLS_SECRETS_REGISTRY="$SECRETS_DIR/registry.json"
    cat > "$TOOLS_SECRETS_REGISTRY" <<'JSON'
{"schema_version":1,"provider":"1password","secrets":{"example.token":"op://Infrastructure/Example/credential"}}
JSON
    cat > "$SECRETS_DIR/bin/op" <<'SH'
#!/usr/bin/env bash
[[ "$1" == read && "$2" == --no-newline && "$3" == "op://Infrastructure/Example/credential" ]] || exit 9
printf 'fixture-secret'
SH
    chmod +x "$SECRETS_DIR/bin/op"
    export PATH="$SECRETS_DIR/bin:$PATH"
}

read_secret() {
    run bash -c 'source "$TOOLS_HOME/lib/common.sh"; source "$TOOLS_HOME/lib/secrets.sh"; secret_read "$1"' _ "$1"
}

@test "registry validates and inventory exposes logical ids only" {
    run bash -c 'source "$TOOLS_HOME/lib/common.sh"; source "$TOOLS_HOME/lib/secrets.sh"; secrets_registry_check && secrets_inventory'
    [ "$status" -eq 0 ]
    [ "$output" = "example.token" ]
}

@test "secret_read resolves a logical id through op" {
    read_secret example.token
    [ "$status" -eq 0 ]
    [ "$output" = "fixture-secret" ]
}

@test "unknown logical ids fail without invoking a fallback" {
    read_secret missing.token
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown secret id: missing.token"* ]]
}

@test "provider failures never print the reference or a secret" {
    printf '#!/usr/bin/env bash\nexit 3\n' > "$SECRETS_DIR/bin/op"
    chmod +x "$SECRETS_DIR/bin/op"
    read_secret example.token
    [ "$status" -ne 0 ]
    [[ "$output" == *"could not read example.token"* ]]
    [[ "$output" != *"op://"* ]]
    [[ "$output" != *"fixture-secret"* ]]
}
