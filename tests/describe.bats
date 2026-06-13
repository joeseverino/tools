#!/usr/bin/env bats
# describe.bats — the emit-once command-surface contract (lib/describe.sh) and
# the `tools describe` aggregator. The load-bearing test is the round-trip
# invariant: because -h and --describe both render from one describe_spec, the
# set of options/commands in the rendered usage must equal the set in the JSON.

load helpers

# Run a synthetic describe_spec through the engine and capture either the JSON
# (mode=json) or the usage text (mode=usage). Keeps the spec in one place so the
# two renderers are exercised from identical input.
render() {
    local mode="$1"
    bash -c '
        source "$TOOLS_HOME/lib/common.sh"
        source "$TOOLS_HOME/lib/describe.sh"
        describe_spec() {
            desc_tool "demo" "A demo tool."
            desc_synopsis "demo [options] <file>..."
            desc_para "First paragraph."
            desc_opt -c --copy             -- "Keep the original"
            desc_opt -k --key PATH +repeat -- "Add a key (repeatable)"
            desc_opt --filter "{all,published,draft}" -- "Which items"
            desc_pos file +variadic        -- "File(s) to act on"
            desc_cmd run -- "Run it"
            desc_opt --fast -- "Run faster"
            desc_pos target -- "What to run"
            desc_env DEMO_HOME -- "Where demo lives"
            desc_example "demo a.txt" -- "the common case"
        }
        if [ "$1" = json ]; then describe_emit; else usage; fi
    ' _ "$mode"
}

@test "describe_render_json emits the versioned contract envelope" {
    run render json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["ok"] is True
assert o["schema_version"] == 1
assert o["name"] == "demo"
assert o["description"] == "A demo tool."
for k in ("global_options","positionals","commands"):
    assert isinstance(o[k], list), k
'
}

@test "options carry flags / takes_value / repeatable / choices" {
    run render json
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
g={x["name"]:x for x in o["global_options"]}
assert g["--copy"]["flags"]==["-c","--copy"]
assert g["--copy"]["takes_value"] is False
assert g["--key"]["takes_value"] is True
assert g["--key"]["repeatable"] is True
assert g["--filter"]["choices"]==["all","published","draft"]
assert "repeatable" not in g["--copy"]
'
}

@test "positionals map required/variadic; top-level vs command scope" {
    run render json
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
# top-level positional
p={x["name"]:x for x in o["positionals"]}
assert p["file"]["positional"] is True and p["file"]["required"] is True
# command + its scoped args
cmd={c["name"]:c for c in o["commands"]}
assert "run" in cmd
names={a["name"] for a in cmd["run"]["args"]}
assert "target" in names and "--fast" in names
'
}

@test "usage renders Usage/Commands/Options sections plus the implicit -h" {
    run render usage
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: demo [options] <file>..."* ]]
    [[ "$output" == *"Commands:"* ]]
    [[ "$output" == *"run"* ]]
    [[ "$output" == *"-c, --copy"* ]]
    [[ "$output" == *"-h, --help"* ]]
    [[ "$output" == *"Environment:"* ]]
    [[ "$output" == *"Examples:"* ]]
}

@test "round-trip invariant: every JSON option/command appears in usage" {
    json=$(render json)
    usage=$(render usage)
    # Collect every long flag and command name from the JSON contract.
    tokens=$(printf '%s' "$json" | python3 -c '
import json,sys
o=json.load(sys.stdin)
toks=set()
def opts(lst):
    for a in lst:
        for f in a.get("flags",[]):
            if f.startswith("--"): toks.add(f)
opts(o["global_options"])
for c in o["commands"]:
    toks.add(c["name"]); opts(c["args"])
print("\n".join(sorted(toks)))
')
    while IFS= read -r tok; do
        [ -n "$tok" ] || continue
        if [[ "$usage" != *"$tok"* ]]; then
            echo "JSON token not present in usage: $tok"
            return 1
        fi
    done <<<"$tokens"
}

@test "engine is byte-identical under bash and zsh" {
    spec='
        source "$TOOLS_HOME/lib/common.sh"; source "$TOOLS_HOME/lib/describe.sh"
        describe_spec(){ desc_tool t d; desc_opt -d X -- h; desc_cmd c -- s; desc_opt --foo "{a,b}" -- hh; }
        describe_emit'
    bash_out=$(bash -c "$spec")
    if command -v zsh >/dev/null 2>&1; then
        zsh_out=$(zsh -c "$spec")
        [ "$bash_out" = "$zsh_out" ]
    else
        skip "zsh not installed"
    fi
}

@test "a real tool self-describes (encrypt)" {
    setup_crypt
    run "$TOOLS_HOME/bin/encrypt" --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["ok"] is True and o["name"]=="encrypt"
names={a["name"] for a in o["global_options"]}
assert "--copy" in names and "--key" in names
'
}

@test "tools describe aggregates every bin/ tool, deterministically" {
    setup_crypt
    run "$TOOLS_HOME/bin/tools" describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["ok"] is True and o["repo"]=="tools"
names=[t["name"] for t in o["tools"]]
# every executable in bin/ is represented exactly once
import os
binset={f for f in os.listdir(os.path.join(os.environ["TOOLS_HOME"],"bin"))}
assert binset == set(names), (binset ^ set(names))
'
    run2="$("$TOOLS_HOME/bin/tools" describe)"
    [ "$output" = "$run2" ]
}

@test "tools describe <tool> delegates to that tool" {
    setup_crypt
    run "$TOOLS_HOME/bin/tools" describe encrypt
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c 'import json,sys; assert json.load(sys.stdin)["name"]=="encrypt"'
}
