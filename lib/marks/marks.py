#!/usr/bin/env python3
"""marks.py — the one Safari surface: plist reader + vault-note writer.

Safari's Bookmarks.plist (native iCloud-synced store) is the single source of
truth; this file is the only code that parses it and the only code that writes
the derived vault notes. bin/marks is dispatch + describe only.

Model (emit once):        load() -> {reading_list, bookmarks, favorites}
Derived surfaces:         export (JSON) · list/status (text or JSON) ·
                          sync (current notes regenerated + append-only ledgers)

Vault layout under --dir (the Life vault's Bookmarks/ folder):
    Reading List.md                  current — exact mirror, regenerated
    Bookmarks.md                     current — bookmarks + favorites mirror
    Archive/Reading List Archive.md  append-only ledger, deduped by URL
    Archive/Bookmarks Archive.md     append-only ledger, deduped by URL

Sync state (last run, counts) lives in the state file, not in the notes, so
note content stays pure and re-runs are byte-identical no-ops.

Cross-repo contract: JSON modes print one object; {"ok": false, "error": msg}
and exit 1 on failure.
"""

import argparse
import json
import os
import plistlib
import re
import sys
from datetime import date, datetime

COLLECTIONS = ("reading-list", "bookmarks", "favorites")

CURRENT_READING = "Reading List.md"
CURRENT_BOOKMARKS = "Bookmarks.md"
LEDGER_READING = os.path.join("Archive", "Reading List Archive.md")
LEDGER_BOOKMARKS = os.path.join("Archive", "Bookmarks Archive.md")

DERIVED_NOTICE = "> Derived from Safari by `marks sync` — do not edit by hand."


def fail(msg, as_json):
    if as_json:
        print(json.dumps({"ok": False, "error": msg}))
    else:
        print(f"marks: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- model ----

def _leaf(node, folder=None):
    uri = node.get("URIDictionary", {})
    url = node.get("URLString", "")
    added = node.get("dateAdded") or node.get("ReadingList", {}).get("DateAdded")
    item = {
        "title": (uri.get("title") or url).strip(),
        "url": url,
        "added": added.strftime("%Y-%m-%d") if isinstance(added, datetime) else None,
    }
    preview = node.get("ReadingList", {}).get("PreviewText", "").strip()
    if preview:
        item["preview"] = preview
    if folder:
        item["folder"] = folder
    return item


def _walk_folder(node, folder, out):
    for child in node.get("Children", []):
        kind = child.get("WebBookmarkType")
        if kind == "WebBookmarkTypeLeaf":
            out.append(_leaf(child, folder))
        elif kind == "WebBookmarkTypeList":
            sub = child.get("Title", "")
            _walk_folder(child, f"{folder}/{sub}" if folder else sub, out)


def load(plist_path):
    """Parse Bookmarks.plist into the canonical model.

    Safari's layout: BookmarksBar = Favorites; BookmarksMenu = filed
    bookmarks; loose top-level leaves = unfiled sidebar bookmarks;
    com.apple.ReadingList = the Reading List.
    """
    with open(plist_path, "rb") as f:
        root = plistlib.load(f)

    reading, bookmarks, favorites = [], [], []
    for top in root.get("Children", []):
        kind = top.get("WebBookmarkType")
        title = top.get("Title", "")
        if kind == "WebBookmarkTypeLeaf":
            bookmarks.append(_leaf(top))
        elif title == "com.apple.ReadingList":
            reading = [_leaf(c) for c in top.get("Children", [])]
        elif title == "BookmarksBar":
            _walk_folder(top, None, favorites)
        elif title == "BookmarksMenu":
            _walk_folder(top, None, bookmarks)

    reading.sort(key=lambda i: i["added"] or "0000", reverse=True)
    return {"reading-list": reading, "bookmarks": bookmarks, "favorites": favorites}


# ------------------------------------------------------------ rendering ----

def _md_url(url):
    """Escape a URL for a [](…) target; the escaped form is also the ledger
    dedupe key, so it must be deterministic."""
    return url.replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def _md_title(title, limit=120):
    t = re.sub(r"\s+", " ", title).replace("[", "(").replace("]", ")")
    return t[: limit - 1] + "…" if len(t) > limit else t


def _line(item):
    link = f"[{_md_title(item['title'])}]({_md_url(item['url'])})"
    prefix = f"{item['added']} — " if item["added"] else ""
    suffix = f" · {item['folder']}" if item.get("folder") else ""
    return f"- {prefix}{link}{suffix}"


def _note(doc_id, title, body_lines):
    head = [
        "---",
        f"doc_id: {doc_id}",
        f"title: {title}",
        "doc_type: resource",
        "---",
        "",
        f"# {title}",
        "",
        DERIVED_NOTICE,
        "",
    ]
    return "\n".join(head + body_lines) + "\n"


def _section(items):
    return [_line(i) for i in items] if items else ["*(empty)*"]


def render_current_reading(model):
    items = model["reading-list"]
    body = [f"{len(items)} items in Safari's Reading List.", ""] + _section(items)
    return _note("safari-reading-list", "Safari Reading List", body)


def render_current_bookmarks(model):
    bm, fav = model["bookmarks"], model["favorites"]
    body = [f"{len(bm)} bookmarks · {len(fav)} favorites in Safari.", ""]
    body += ["## Bookmarks", ""] + _section(bm) + ["", "## Favorites (Bookmarks Bar)", ""]
    body += _section(fav)
    return _note("safari-bookmarks", "Safari Bookmarks", body)


# --------------------------------------------------------------- ledger ----

LEDGER_META = {
    LEDGER_READING: ("archive-safari-reading-list", "Safari Reading List — Archive"),
    LEDGER_BOOKMARKS: ("archive-safari-bookmarks", "Safari Bookmarks — Archive"),
}

LINK_TARGET = re.compile(r"\]\(([^)]+)\)")


def _ledger_urls(text):
    return set(LINK_TARGET.findall(text))


def _dedupe(items):
    seen, out = set(), []
    for i in items:
        key = _md_url(i["url"])
        if key not in seen:
            seen.add(key)
            out.append(i)
    return out


def append_ledger(path, rel, items, today):
    """Append items whose URL the ledger has never seen, under a dated
    heading. Returns the number appended. Never rewrites existing lines."""
    doc_id, title = LEDGER_META[rel]
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            text = f.read()
    else:
        text = "\n".join(
            ["---", f"doc_id: {doc_id}", f"title: {title}", "doc_type: resource",
             "---", "", f"# {title}", ""]
        ) + "\n"

    new = [i for i in _dedupe(items) if _md_url(i["url"]) not in _ledger_urls(text)]
    if not new:
        return 0, text if os.path.exists(path) else None

    heading = f"## Archived {today}"
    lines = [_line(i) for i in new]
    if heading in text.splitlines():
        # extend today's section in place: insert before the next heading
        parts = text.split(heading, 1)
        rest = parts[1]
        nxt = rest.find("\n## ")
        block = rest if nxt == -1 else rest[:nxt]
        block = block.rstrip("\n") + "\n" + "\n".join(lines) + "\n"
        text = parts[0] + heading + block + ("" if nxt == -1 else rest[nxt:])
    else:
        text = text.rstrip("\n") + f"\n\n{heading}\n\n" + "\n".join(lines) + "\n"
    return len(new), text


# ----------------------------------------------------------------- sync ----

def write_if_changed(path, content):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if f.read() == content:
                return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return True


def cmd_sync(model, args):
    today = date.today().isoformat()
    plan = [
        (CURRENT_READING, render_current_reading(model)),
        (CURRENT_BOOKMARKS, render_current_bookmarks(model)),
    ]
    archived = {}
    for rel, items in (
        (LEDGER_READING, model["reading-list"]),
        (LEDGER_BOOKMARKS, model["bookmarks"] + model["favorites"]),
    ):
        n, text = append_ledger(os.path.join(args.dir, rel), rel, items, today)
        archived[rel] = n
        if text is not None:
            plan.append((rel, text))

    changed = []
    if not args.dry_run:
        for rel, content in plan:
            if write_if_changed(os.path.join(args.dir, rel), content):
                changed.append(rel)
        state = {
            "last_sync": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "dir": args.dir,
            "counts": {k: len(v) for k, v in model.items()},
            "archived_total": _ledger_totals(args.dir),
        }
        os.makedirs(os.path.dirname(args.state), exist_ok=True)
        with open(args.state, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
            f.write("\n")

    summary = {
        "ok": True,
        "dir": args.dir,
        "dry_run": args.dry_run,
        "current": {k: len(v) for k, v in model.items()},
        "archived_new": {
            "reading-list": archived[LEDGER_READING],
            "bookmarks": archived[LEDGER_BOOKMARKS],
        },
        "changed": changed,
    }
    if args.json:
        print(json.dumps(summary, indent=2))
        return
    c, a = summary["current"], summary["archived_new"]
    verb = "would archive" if args.dry_run else "archived"
    print(f"current    {c['reading-list']} reading list · {c['bookmarks']} bookmarks · {c['favorites']} favorites")
    print(f"{verb:<10} +{a['reading-list']} reading list · +{a['bookmarks']} bookmarks")
    if not args.dry_run:
        print(f"notes      {args.dir}" + (f"  ({len(changed)} updated)" if changed else "  (no changes)"))


# --------------------------------------------------------------- status ----

def _ledger_totals(dirpath):
    totals = {}
    for rel in (LEDGER_READING, LEDGER_BOOKMARKS):
        path = os.path.join(dirpath, rel)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                totals[rel] = len(_ledger_urls(f.read()))
        else:
            totals[rel] = 0
    return totals


def cmd_status(model, args):
    totals = _ledger_totals(args.dir)
    last = None
    if os.path.exists(args.state):
        with open(args.state, encoding="utf-8") as f:
            last = json.load(f).get("last_sync")
    if args.json:
        print(json.dumps({
            "ok": True,
            "current": {k: len(v) for k, v in model.items()},
            "archived_total": totals,
            "last_sync": last,
        }, indent=2))
        return
    print(f"reading list   {len(model['reading-list'])} in Safari · {totals[LEDGER_READING]} archived")
    print(f"bookmarks      {len(model['bookmarks'])} in Safari (+{len(model['favorites'])} favorites) · {totals[LEDGER_BOOKMARKS]} archived")
    print(f"last sync      {last or 'never'}")


def cmd_list(model, args):
    items = model[args.collection]
    if args.json:
        print(json.dumps({"ok": True, "collection": args.collection, "items": items}, indent=2))
        return
    if not items:
        print(f"(no {args.collection.replace('-', ' ')} items)")
        return
    for i in items:
        added = i["added"] or "          "
        folder = f"  [{i['folder']}]" if i.get("folder") else ""
        print(f"{added}  {i['title']}{folder}")
        print(f"            {i['url']}")


def cmd_export(model, _args):
    print(json.dumps({"ok": True, **{k: v for k, v in model.items()}}, indent=2))


# ----------------------------------------------------------------- main ----

def main():
    p = argparse.ArgumentParser(prog="marks.py")
    p.add_argument("--plist", required=True)
    p.add_argument("--dir", required=True)
    p.add_argument("--state", required=True)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("status", "sync", "export"):
        sp = sub.add_parser(name)
        sp.add_argument("--json", action="store_true")
        if name == "sync":
            sp.add_argument("--dry-run", action="store_true")
    lp = sub.add_parser("list")
    lp.add_argument("collection", choices=COLLECTIONS)
    lp.add_argument("--json", action="store_true")
    args = p.parse_args()
    if not hasattr(args, "json"):
        args.json = False

    if not os.path.exists(args.plist):
        fail(f"Safari bookmarks plist not found: {args.plist}", args.json)
    try:
        model = load(args.plist)
    except Exception as e:  # corrupt plist, permission denied (Full Disk Access)
        fail(f"could not read {args.plist}: {e}", args.json)

    {"status": cmd_status, "sync": cmd_sync, "list": cmd_list, "export": cmd_export}[args.cmd](model, args)


if __name__ == "__main__":
    main()
