"""pdf_fill.cli — command-line entry point for the pdf-fill tool.

Usage:
  pdf-fill has-form <pdf>
  pdf-fill acroform-fields <pdf>
  pdf-fill fill-acroform <pdf> <fields.json> <out.pdf>
  pdf-fill fill-flat <pdf> <fields.json> <out.pdf> [--page N]

fill-acroform's fields.json: {"Field Name": "value", ...} — straight from
acroform-fields' output.

fill-flat's fields.json: a list of field specs —
  [{"label": "Total Cholesterol", "value": "149"},
   {"label": "Patient fasting?", "checkbox": true},
   {"label": "Date of Test", "value": "02", "occurrence": 0, "box_count": 2, "box_offset": 0},
   {"label": "Date of Test", "value": "12", "occurrence": 0, "box_count": 2, "box_offset": 2},
   {"label": "Date of Test", "value": "2026", "occurrence": 0, "box_count": 4, "box_offset": 4},
   {"label": "Date of Test", "value": "77", "occurrence": 1, "box_count": 3, "box_offset": 0},
   {"label": "Healthcare provider name", "skip": true}]
`box_count`/`box_offset` carve out which boxes belong to which field when
one label sits in front of more than one group (month/day/year all behind
one "Date of Test:" label) — deliberately not auto-split by gap width,
since on a real form the gap between groups and a box's own width can be
only a few points apart, too ambiguous to guess reliably. You're looking
at the form; say how many boxes and where they start.

`occurrence` (0-indexed, default 0) picks which instance of a repeated
label to anchor on when the same text appears more than once on the page
(e.g. "Date of Test:" under the cholesterol, glucose, and blood-pressure
sections) — count top-to-bottom as the label appears on the form.

`search_width` (points, default 320) caps how far right of the label to
look for boxes. On a dense multi-column form the next column's boxes can
sit well inside the default and get pulled in by mistake — narrow this
per-field once you can see on the form how far its own boxes actually go.

`skip: true` documents a field left alone on purpose — e.g. one requiring
an actual person's signature — so it shows up in the result report as
accounted for, not silently missing.

fill-flat always prints a per-field result — ok/not, and why not — so a
field that didn't get placed is never silently dropped. Check the output
PDF visually before treating it as done; this finds boxes, it doesn't
understand the form.
"""

from __future__ import annotations

import argparse
import json
import sys

from .core import (
    FieldSpec,
    acroform_field_names,
    fill_acroform,
    fill_flat_form,
    has_acroform,
)


def _load_flat_specs(path: str) -> list[FieldSpec]:
    with open(path) as f:
        raw = json.load(f)
    return [FieldSpec(**item) for item in raw]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="pdf-fill", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    hf = sub.add_parser("has-form", help="does this PDF have real AcroForm fields?")
    hf.add_argument("pdf")

    af = sub.add_parser("acroform-fields", help="list a fillable PDF's field names")
    af.add_argument("pdf")

    fa = sub.add_parser("fill-acroform", help="fill real form fields by name")
    fa.add_argument("pdf")
    fa.add_argument("fields_json")
    fa.add_argument("out_pdf")

    ff = sub.add_parser("fill-flat", help="fill a flat/scanned form by label")
    ff.add_argument("pdf")
    ff.add_argument("fields_json")
    ff.add_argument("out_pdf")
    ff.add_argument("--page", type=int, default=0)

    args = p.parse_args(argv)

    if args.cmd == "has-form":
        print("yes" if has_acroform(args.pdf) else "no")
        return 0

    if args.cmd == "acroform-fields":
        for name in acroform_field_names(args.pdf):
            print(name)
        return 0

    if args.cmd == "fill-acroform":
        with open(args.fields_json) as f:
            values = json.load(f)
        fill_acroform(args.pdf, values, args.out_pdf)
        print(f"wrote {args.out_pdf}")
        return 0

    if args.cmd == "fill-flat":
        specs = _load_flat_specs(args.fields_json)
        results = fill_flat_form(args.pdf, specs, args.out_pdf, page_number=args.page)
        failed = 0
        for r in results:
            mark = "OK  " if r.ok else "FAIL"
            reason = f" — {r.reason}" if r.reason else ""
            print(f"{mark} {r.field.label!r} (occurrence {r.field.occurrence}, "
                  f"offset {r.field.box_offset}){reason}")
            if not r.ok:
                failed += 1
        print(f"\nwrote {args.out_pdf} — {len(results) - failed}/{len(results)} fields placed")
        return 1 if failed else 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
