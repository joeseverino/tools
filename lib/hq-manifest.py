#!/usr/bin/env python3
"""
Walk the vault, extract YAML frontmatter from every `.md` under the
configured doc folders, and emit a JSON array suitable for
`manage.py import_docs_manifest -` on Severino HQ.

Usage:
    hq-manifest.py <vault-root> <colon-separated-subdirs>

Stdin/stderr conventions:
  - JSON array on stdout (the manifest)
  - Status / warnings on stderr

The frontmatter parser is intentionally hand-rolled — no PyYAML dependency.
It supports exactly the shape documented in
`02 Infrastructure/Severino HQ/Frontmatter Schema.md`: simple key: value,
inline `[a, b, c]` lists, and block `- item` lists.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


# Set of keys Severino HQ's importer understands.
HQ_KEYS = {
    "doc_id", "title", "doc_type", "system", "environment",
    "status", "sensitivity", "obsidian_path", "github_path",
    "external_url", "last_reviewed", "notes",
    "related_projects", "related_assets",
    # Publishing pipeline fields (used by public_article_draft docs to
    # also upsert a ContentItem row in HQ).
    "published_at", "content_type", "tags",
}

SKIP_DIR_NAMES = {
    ".git",
    ".obsidian",
    "00 Templates",
    "Templates",
    "source",
}


def should_skip_path(path: Path) -> bool:
    return any(part in SKIP_DIR_NAMES for part in path.parts)


def _parse_yaml_block(block: str) -> dict:
    """Parse a constrained YAML subset (key: value, lists)."""
    data: dict = {}
    current_list_key: str | None = None

    for raw in block.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            current_list_key = None
            continue

        # Block-list continuation: "  - item"
        if current_list_key and re.match(r"^\s+-\s+", raw):
            item = raw.strip()[2:].strip()
            data.setdefault(current_list_key, []).append(_scalar(item))
            continue

        # Otherwise a top-level "key: value" or "key:" (begins a block list)
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", raw)
        if not m:
            current_list_key = None
            continue

        key, value = m.group(1), m.group(2).strip()
        if value == "":
            current_list_key = key
            data[key] = []
            continue

        current_list_key = None

        # Inline list "[a, b]"
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            data[key] = [_scalar(x) for x in _split_inline_list(inner)]
            continue

        data[key] = _scalar(value)

    return data


def _split_inline_list(inner: str) -> list[str]:
    if not inner:
        return []
    out, depth, buf = [], 0, []
    for ch in inner:
        if ch == "," and depth == 0:
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
    out.append("".join(buf).strip())
    return [x for x in out if x]


def _scalar(token: str):
    """Strip quotes, recognize null/booleans, leave dates as strings."""
    token = token.strip()
    if (len(token) >= 2) and token[0] == token[-1] and token[0] in ('"', "'"):
        token = token[1:-1]
    if token in ("null", "~", ""):
        return None
    if token == "true":
        return True
    if token == "false":
        return False
    return token


def extract_frontmatter(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.lstrip().startswith("---"):
        return None
    # Find first --- (start) and the next --- (end).
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == "---":
            start = i
            break
    if start is None:
        return None
    end = None
    for i in range(start + 1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return None
    return _parse_yaml_block("\n".join(lines[start + 1:end]))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: hq-manifest.py <vault-root> <a:b:c>", file=sys.stderr)
        return 2

    vault = Path(argv[1])
    subdirs = [s for s in argv[2].split(":") if s]
    if not vault.is_dir():
        print(f"vault root not found: {vault}", file=sys.stderr)
        return 2

    entries: list[dict] = []
    seen_ids: dict[str, Path] = {}
    missing_frontmatter: list[Path] = []

    for sub in subdirs:
        root = vault / sub
        if not root.is_dir():
            print(f"warn: {sub} not under vault, skipping", file=sys.stderr)
            continue
        for path in sorted(root.rglob("*.md")):
            # Skip templates, private working material, and "_*" hidden files.
            if should_skip_path(path):
                continue
            if path.name.startswith("_"):
                continue
            fm = extract_frontmatter(path)
            if fm is None:
                missing_frontmatter.append(path)
                continue
            if not fm.get("doc_id"):
                missing_frontmatter.append(path)
                continue

            # Pull only the fields HQ knows about; also surface `path` for context.
            entry: dict = {k: fm[k] for k in fm if k in HQ_KEYS}
            entry["path"] = str(path.relative_to(vault))

            dup = seen_ids.get(entry["doc_id"])
            if dup:
                print(
                    f"warn: duplicate doc_id {entry['doc_id']!r}: "
                    f"{dup.relative_to(vault)} and {path.relative_to(vault)}",
                    file=sys.stderr,
                )
            seen_ids[entry["doc_id"]] = path

            entries.append(entry)

    if missing_frontmatter:
        print(
            f"warn: {len(missing_frontmatter)} file(s) missing frontmatter "
            f"(skipped) — run `hq doctor` to list them",
            file=sys.stderr,
        )

    print(json.dumps(entries, indent=2))
    print(f"ok: {len(entries)} entries", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
