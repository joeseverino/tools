#!/usr/bin/env bats
# home.bats: a checkout runs its own files: an exported TOOLS_HOME naming a
# different checkout changes nothing about which code, configs or tools run.

load helpers

# A second checkout whose remember answers --describe with the TOOLS_HOME it
# was handed, so a call that reaches it proves which checkout spawned it.
second_checkout() {
    copy="$BATS_TEST_TMPDIR/second"
    mkdir -p "$copy"
    cp -R "$TOOLS_HOME/bin" "$TOOLS_HOME/lib" "$TOOLS_HOME/config" "$TOOLS_HOME/package.json" "$copy/"
    ln -s "$TOOLS_HOME/node_modules" "$copy/node_modules"
    printf '#!/usr/bin/env bash\nprintf "{\\"home\\":\\"%%s\\"}\\n" "$TOOLS_HOME"\n' > "$copy/bin/remember"
    chmod +x "$copy/bin/remember"
    copy="$(cd "$copy" && pwd -P)"
}

@test "a tool run from a second checkout spawns that checkout's tools and hands it down" {
    second_checkout
    run env TOOLS_HOME="$TOOLS_HOME" "$copy/bin/tools" describe remember
    [ "$status" -eq 0 ]
    [ "$output" = "{\"home\":\"$copy\"}" ]
}

@test "the shell SDK sourced from a second checkout loads that checkout" {
    second_checkout
    run env TOOLS_HOME="$TOOLS_HOME" bash -c 'source "$1/lib/sdk.sh"; printf "%s\n" "$TOOLS_HOME"' _ "$copy"
    [ "$status" -eq 0 ]
    [ "$output" = "$copy" ]
}
