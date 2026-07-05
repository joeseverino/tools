#!/usr/bin/env bats
# marks — Safari plist → Life-vault mirror + append-only ledgers.
# Hermetic: a fixture plist built with plistlib, all paths in the test tmpdir.

load helpers

setup() {
    export MARKS_PLIST="$BATS_TEST_TMPDIR/Bookmarks.plist"
    export MARKS_DIR="$BATS_TEST_TMPDIR/Bookmarks"
    export MARKS_STATE="$BATS_TEST_TMPDIR/state/marks-sync.json"
    make_plist
}

# Build the fixture plist. Args name extra items:
#   --extra-reading  adds a second reading-list item
#   --no-reading     empties the reading list (post-cleanup Safari)
make_plist() {
    python3 - "$MARKS_PLIST" "$@" <<'EOF'
import plistlib, sys
from datetime import datetime

path, flags = sys.argv[1], set(sys.argv[2:])

def leaf(title, url, **kw):
    d = {"WebBookmarkType": "WebBookmarkTypeLeaf",
         "URLString": url, "URIDictionary": {"title": title}}
    d.update(kw)
    return d

reading = []
if "--no-reading" not in flags:
    reading.append(leaf("Read me", "https://example.com/article",
        ReadingList={"DateAdded": datetime(2026, 1, 2), "PreviewText": "hi"}))
    if "--extra-reading" in flags:
        reading.append(leaf("Newer piece", "https://example.com/newer",
            ReadingList={"DateAdded": datetime(2026, 3, 4)}))

root = {"Children": [
    {"WebBookmarkType": "WebBookmarkTypeList", "Title": "BookmarksBar",
     "Children": [
        leaf("Fav one", "https://fav.example.com/"),
        {"WebBookmarkType": "WebBookmarkTypeList", "Title": "Work",
         "Children": [leaf("Nested fav", "https://fav.example.com/nested (v2)")]},
     ]},
    {"WebBookmarkType": "WebBookmarkTypeList", "Title": "BookmarksMenu", "Children": []},
    {"WebBookmarkType": "WebBookmarkTypeList", "Title": "com.apple.ReadingList",
     "Children": reading},
    leaf("Loose bookmark", "https://loose.example.com/",
         dateAdded=datetime(2026, 2, 3)),
]}
with open(path, "wb") as f:
    plistlib.dump(root, f)
EOF
}

@test "marks status reports counts and never-synced" {
    run "$TOOLS_HOME/bin/marks" status
    [ "$status" -eq 0 ]
    grep -qF "reading list   1 in Safari · 0 archived" <<<"$output" \
        && grep -qF "bookmarks      1 in Safari (+2 favorites) · 0 archived" <<<"$output" \
        && grep -qF "last sync      never" <<<"$output"
}

@test "marks export emits the canonical model" {
    run "$TOOLS_HOME/bin/marks" export
    [ "$status" -eq 0 ]
    OUTPUT="$output" python3 - <<'EOF'
import json, os
d = json.loads(os.environ["OUTPUT"])
assert d["ok"] is True
assert [i["url"] for i in d["reading-list"]] == ["https://example.com/article"]
assert d["reading-list"][0]["preview"] == "hi"
assert [i["url"] for i in d["bookmarks"]] == ["https://loose.example.com/"]
assert d["bookmarks"][0]["added"] == "2026-02-03"
assert [i.get("folder") for i in d["favorites"]] == [None, "Work"]
EOF
}

@test "marks sync creates current notes and ledgers; re-run is a no-op" {
    run "$TOOLS_HOME/bin/marks" sync
    [ "$status" -eq 0 ]
    [ -f "$MARKS_DIR/Reading List.md" ] \
        && [ -f "$MARKS_DIR/Bookmarks.md" ] \
        && [ -f "$MARKS_DIR/Archive/Reading List Archive.md" ] \
        && [ -f "$MARKS_DIR/Archive/Bookmarks Archive.md" ] \
        && [ -f "$MARKS_STATE" ]

    before="$(cat "$MARKS_DIR/Archive/Bookmarks Archive.md" "$MARKS_DIR/Bookmarks.md")"
    run "$TOOLS_HOME/bin/marks" sync
    [ "$status" -eq 0 ]
    after="$(cat "$MARKS_DIR/Archive/Bookmarks Archive.md" "$MARKS_DIR/Bookmarks.md")"
    grep -qF -- "+0 reading list · +0 bookmarks" <<<"$output" \
        && [ "$before" = "$after" ]
}

@test "sync escapes parens in URLs so markdown links survive" {
    run "$TOOLS_HOME/bin/marks" sync
    [ "$status" -eq 0 ]
    grep -qF "(https://fav.example.com/nested%20%28v2%29)" "$MARKS_DIR/Bookmarks.md"
}

@test "new Safari item appends to the ledger; cleanup shrinks current but not archive" {
    run "$TOOLS_HOME/bin/marks" sync
    [ "$status" -eq 0 ]

    make_plist --extra-reading
    run "$TOOLS_HOME/bin/marks" sync --json
    [ "$status" -eq 0 ]
    OUTPUT="$output" python3 - <<'EOF'
import json, os
d = json.loads(os.environ["OUTPUT"])
assert d["archived_new"] == {"reading-list": 1, "bookmarks": 0}, d
assert d["current"]["reading-list"] == 2
EOF

    # Safari cleaned out (the triage beat): current empties, ledger keeps both.
    make_plist --no-reading
    run "$TOOLS_HOME/bin/marks" sync
    [ "$status" -eq 0 ]
    grep -qF "0 items in Safari's Reading List." "$MARKS_DIR/Reading List.md" \
        && grep -qF "https://example.com/article" "$MARKS_DIR/Archive/Reading List Archive.md" \
        && grep -qF "https://example.com/newer" "$MARKS_DIR/Archive/Reading List Archive.md"
}

@test "sync --dry-run writes nothing" {
    run "$TOOLS_HOME/bin/marks" sync --dry-run
    [ "$status" -eq 0 ]
    grep -qF "would archive" <<<"$output" \
        && [ ! -d "$MARKS_DIR" ] \
        && [ ! -f "$MARKS_STATE" ]
}

@test "marks list renders a collection; bad collection is a usage error" {
    run "$TOOLS_HOME/bin/marks" list reading-list
    [ "$status" -eq 0 ]
    grep -qF "2026-01-02  Read me" <<<"$output"

    run "$TOOLS_HOME/bin/marks" list nonsense
    [ "$status" -ne 0 ]
}

@test "missing plist fails closed with the json error envelope" {
    export MARKS_PLIST="$BATS_TEST_TMPDIR/absent.plist"
    run "$TOOLS_HOME/bin/marks" status --json
    [ "$status" -eq 1 ]
    OUTPUT="$output" python3 - <<'EOF'
import json, os
d = json.loads(os.environ["OUTPUT"])
assert d["ok"] is False and "not found" in d["error"]
EOF
}

@test "unknown command shows the derived surface" {
    run "$TOOLS_HOME/bin/marks" bogus
    [ "$status" -ne 0 ]
    grep -q "unknown command" <<<"$output" && grep -q "sync" <<<"$output"
}
