#!/usr/bin/env python3
"""Translate the human `hq create` surface into one canonical MCP request."""

from __future__ import annotations

import json
import sys


ALIASES = {
    "project": {
        "technologies": "technologies_used",
        "repo": "repository_url",
        "url": "public_url",
    },
    "asset": {
        "name": "item_name",
        "cost": "total_cost",
        "business_use": "business_use_percentage",
        "payment": "payment_method",
        "serial": "serial_number",
    },
}


def fail(message: str) -> "NoReturn":
    print(f"hq: {message}", file=sys.stderr)
    raise SystemExit(2)


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] not in ALIASES:
        fail("usage: hq create {project,asset} <slug> [--field value ...]")
    kind, slug, *args = sys.argv[1:]
    payload: dict[str, object] = {"slug": slug}
    aliases = ALIASES[kind]
    while args:
        flag = args.pop(0)
        if flag == "--json":
            continue
        if not flag.startswith("--") or not args:
            fail(f"expected --field value, got {flag!r}")
        key = flag[2:].replace("-", "_")
        key = aliases.get(key, key)
        payload[key] = args.pop(0)
    json.dump(
        {
            "tool": "execute_capability",
            "arguments": {"name": f"{kind}.upsert", "payload": payload},
        },
        sys.stdout,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
