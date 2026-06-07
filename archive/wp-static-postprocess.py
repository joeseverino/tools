#!/usr/bin/env python3
"""Post-process a wget-mirrored WordPress site.

Run after `wget --mirror --convert-links --adjust-extension
--restrict-file-names=windows`. Cleans up the artifacts that flag combo
leaves behind:

  1. WordPress ?p=N shortlink references — wget escapes the `?` to `@`,
     producing file names like `index.html@p=807.html` and links
     pointing at them. Each shortlink file contains a
     `<link rel="canonical">` to the real post URL. We use that to
     rewrite every reference to the canonical path, then delete the
     shortlink duplicates.

  2. ?ver= cache-busters on CSS/JS — wget keeps `?ver=...` in the
     filename (as `@ver=...`). We strip that segment from both
     filenames and HTML references.

The script is idempotent: a second run on already-clean output is a
no-op aside from `os.walk` cost. It is also self-contained — invoked by
the `wp-static` shell wrapper, but runnable standalone:

    python3 wp-static-postprocess.py path/to/mirror
"""

from __future__ import annotations

import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


SHORTLINK_RE = re.compile(r"@p=(\d+)\.html$")
VER_RE = re.compile(r"@ver=[^/]*$")


class CanonicalExtractor(HTMLParser):
    """Pull href from the first <link rel="canonical"> tag in a page."""

    def __init__(self) -> None:
        super().__init__()
        self.canonical: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.canonical is not None or tag != "link":
            return
        a = dict(attrs)
        if a.get("rel", "").lower() == "canonical" and a.get("href"):
            self.canonical = a["href"]


def url_to_path(url: str, source_host: str | None) -> str:
    """Convert an absolute canonical URL to a site-absolute path."""
    m = re.match(r"https?://[^/]+(/.*)?$", url)
    if not m:
        return url
    path = m.group(1) or "/"
    if not path.endswith("/") and "." not in path.rsplit("/", 1)[-1]:
        path += "/"
    return path


def find_shortlink_map(root: Path) -> dict[str, str]:
    """For every `*@p=N*.html` file in the mirror, return {N: canonical_path}."""
    out: dict[str, str] = {}
    for path in root.rglob("*@p=*"):
        if not path.is_file() or not path.name.endswith(".html"):
            continue
        m = SHORTLINK_RE.search(path.name)
        if not m:
            continue
        pid = m.group(1)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parser = CanonicalExtractor()
        parser.feed(text)
        if parser.canonical:
            out[pid] = url_to_path(parser.canonical, None)
    return out


def find_ver_renames(root: Path) -> dict[Path, Path]:
    """For every `*@ver=*` file, return {old_path: new_path} stripping the suffix."""
    out: dict[Path, Path] = {}
    for path in root.rglob("*@ver=*"):
        if not path.is_file():
            continue
        new_name = VER_RE.sub("", path.name)
        if new_name != path.name:
            out[path] = path.with_name(new_name)
    return out


def rewrite_html(
    root: Path,
    shortlink_map: dict[str, str],
    ver_basenames: dict[str, str],
) -> tuple[int, int]:
    """Rewrite all HTML files in root. Returns (shortlink_subs, ver_subs)."""
    shortlink_patterns = [
        (re.compile(r"(?:\.\./)*index\.html@p=" + pid + r"\.html"), canon)
        for pid, canon in shortlink_map.items()
    ]
    ver_patterns = [
        (re.compile(re.escape(old)), new) for old, new in ver_basenames.items()
    ]

    s_count = v_count = 0
    for html in root.rglob("*.html"):
        try:
            original = html.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        text = original
        for pat, repl in shortlink_patterns:
            text, n = pat.subn(repl, text)
            s_count += n
        for pat, repl in ver_patterns:
            text, n = pat.subn(repl, text)
            v_count += n
        if text != original:
            html.write_text(text, encoding="utf-8")
    return s_count, v_count


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} <mirror-dir>", file=sys.stderr)
        return 2
    root = Path(argv[1]).resolve()
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2

    shortlinks = find_shortlink_map(root)
    ver_renames = find_ver_renames(root)
    ver_basenames = {old.name: new.name for old, new in ver_renames.items()}

    s_count, v_count = rewrite_html(root, shortlinks, ver_basenames)

    for path in root.rglob("*@p=*"):
        if path.is_file() and path.name.endswith(".html"):
            path.unlink()

    for old, new in ver_renames.items():
        old.rename(new)

    print(f"  postproc   shortlinks: {len(shortlinks)} mapped, {s_count} refs rewritten")
    print(f"  postproc   @ver= files: {len(ver_renames)} renamed, {v_count} refs rewritten")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
