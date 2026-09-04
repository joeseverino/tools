"""pdf_fill.core — fill a PDF form two ways.

Real fillable PDFs have AcroForm fields: fill them directly, by name, and
stop there — that path is small and reliable (fill_acroform).

Flat/scanned forms (a printed form someone signed and mailed back, or a
form whose "boxes" are just drawn lines with no field objects behind them)
have no fields to address. The only anchor available is the printed label
text next to each box. fill_flat_form finds the label, finds the row of
boxes near it (by pairing the vertical wall segments that bound each box —
N+1 walls bound N boxes, however the PDF drew them: real rects, or a curve
per edge), and writes one character per box.

This generalizes the coordinate math done by hand, once, against the 2026
US Wellness physician form (see the Life vault's task-complete-wellness-
screening note) into something reusable against the next form that shows
up looking nothing like that one.
"""

from __future__ import annotations

import io
from collections import Counter
from dataclasses import dataclass, field

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------------------
# AcroForm path — real fillable fields, addressed by name
# ---------------------------------------------------------------------------


def has_acroform(pdf_path: str) -> bool:
    """True if the PDF has real fillable form fields."""
    return bool(PdfReader(pdf_path).get_fields())


def acroform_field_names(pdf_path: str) -> list[str]:
    """Every fillable field name, for a caller building the values dict."""
    fields = PdfReader(pdf_path).get_fields() or {}
    return list(fields)


def fill_acroform(pdf_path: str, values: dict[str, str], out_path: str) -> None:
    """Fill real form fields directly by name. No coordinate math involved —
    prefer this path whenever has_acroform() is True."""
    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    writer.append(reader)
    for page in writer.pages:
        writer.update_page_form_field_values(page, values)
    with open(out_path, "wb") as f:
        writer.write(f)


# ---------------------------------------------------------------------------
# Flat-form path — label-anchored box-row detection
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Box:
    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2


def _cluster_lines(words) -> list[tuple[float, list]]:
    """Group words sharing the same `top` into visual lines (left-to-right
    within a line, lines sorted top-to-bottom) — the unit a wrapped, multi-
    line caption needs, since raw word-list adjacency doesn't hold when an
    unrelated word from another column lands at an intermediate `top`."""
    lines: dict[float, list] = {}
    for w in words:
        lines.setdefault(round(w["top"], 1), []).append(w)
    return [(top, sorted(lines[top], key=lambda w: w["x0"])) for top in sorted(lines)]


def _stacked_matches(words, needle: list[str], max_line_gap: float = 20.0):
    """A label wrapped across consecutive lines, left-aligned (e.g. a
    narrow column forces "Total Cholesterol" onto "Total" / "Cholesterol"
    on the next line) — a real, recurring shape on forms with tight
    columns, not a one-off. Matches needle[:k] as a run *anywhere* within
    one line (other columns can share that same `top`, so the match isn't
    necessarily the line's last word) and needle[k:] as a run starting at
    the same x0 (within 3pt) on a line below it, within `max_line_gap`
    points — narrow enough that an unrelated word from a different column
    sitting at some in-between `top` (as happens on the physician form
    this tool targets) doesn't get pulled in."""
    lines = _cluster_lines(words)
    n = len(needle)
    matches = []
    for li, (top_a, line_a) in enumerate(lines):
        texts_a = [w["text"].lower().strip(":") for w in line_a]
        for k in range(1, n):
            rest = n - k
            for i in range(len(texts_a) - k + 1):
                if texts_a[i:i + k] != needle[:k]:
                    continue
                x0_ref = line_a[i]["x0"]
                for lj in range(li + 1, len(lines)):
                    top_b, line_b = lines[lj]
                    if top_b - top_a > max_line_gap:
                        break
                    texts_b = [w["text"].lower().strip(":") for w in line_b]
                    for j in range(len(texts_b) - rest + 1):
                        if texts_b[j:j + rest] != needle[k:]:
                            continue
                        if abs(line_b[j]["x0"] - x0_ref) > 3:
                            continue
                        matches.append((
                            x0_ref, line_b[j + rest - 1]["x1"], top_a, line_b[j]["bottom"],
                        ))
    return matches


def find_label(
    page, text: str, occurrence: int = 0,
) -> tuple[float, float, float, float] | None:
    """The bbox of the `occurrence`-th match of `text` on the page (case-
    insensitive, 0-indexed) — a real form repeats a label across sections
    often enough that "the first match" silently picking the wrong one is
    a real failure mode, not a hypothetical: the physician form that
    motivated this tool has "Date of Test:" three times (cholesterol,
    glucose/A1c, blood pressure) and "Date of Measurement:" twice (waist,
    weight). Tries an exact multi-word run first (e.g. "HDL Cholesterol"
    as two adjacent words on one line), then a label wrapped across two
    lines (e.g. "Total" / "Cholesterol" — the same physician form wraps
    that one caption because its column is too narrow for it), then falls
    back to a substring match within one word. Returns (x0, x1, top,
    bottom), or None if there's no `occurrence`-th match. Matches are
    ordered top-to-bottom, matching how a person reads the form and
    chooses an `occurrence` index."""
    text_l = text.lower()
    words = page.extract_words()
    needle = text_l.split()
    n = len(needle)
    matches = []
    for i in range(len(words) - n + 1):
        run = words[i:i + n]
        if [w["text"].lower().strip(":") for w in run] == needle:
            matches.append((run[0]["x0"], run[-1]["x1"], run[0]["top"], run[-1]["bottom"]))
    if not matches and n > 1:
        matches = _stacked_matches(words, needle)
    if not matches:
        for w in words:
            if text_l in w["text"].lower():
                matches.append((w["x0"], w["x1"], w["top"], w["bottom"]))
    matches.sort(key=lambda m: (m[2], m[0]))
    if occurrence >= len(matches):
        return None
    return matches[occurrence]


def _vertical_walls(page) -> list[tuple[float, float, float]]:
    """Every roughly-vertical line segment on the page — a box's left or
    right wall, whichever primitive the PDF used to draw it (an explicit
    line, a rect's edge, or one border of a curve-drawn box outline).
    Returns (x, top, bottom) triples."""
    walls = []
    for e in page.edges:
        width = e["x1"] - e["x0"]
        height = e["bottom"] - e["top"]
        if height > 3 and width <= 1.5:
            walls.append((e["x0"], e["top"], e["bottom"]))
    return walls


def find_box_rows(
    page,
    near: tuple[float, float, float, float],
    direction: str = "right",
    search_width: float = 320,
    y_tolerance: float = 2.0,
    min_box_width: float = 5.0,
    max_box_width: float = 65.0,
    width_tolerance: float = 0.25,
) -> list[Box]:
    """Every real data-entry box in the row near a label, left to right —
    excluding the wider gaps between separate field groups that can sit
    behind one shared label (month/day/year all behind one "Date of Test:"
    label), so box_offset math on the result stays predictable.

    Measured against a real form: individual boxes in one row are close to
    uniform width (14.2pt each, every one, across three separate groups),
    and the gap between groups (18.4pt) was only ~30% wider — not enough
    margin for a fixed absolute cutoff to separate reliably, so this uses
    the *modal* box width in the row and keeps only spans within
    `width_tolerance` (relative) of it. What it deliberately does NOT do is
    figure out which boxes belong to which field when a label fronts more
    than one group — that's still on the caller, via FieldSpec's
    box_count/box_offset, because "month is 2 boxes, day is 2, year is 4"
    is something you read off the form, not something spacing alone can
    promise to get right every time.

    Row selection picks whichever candidate row's vertical center is
    *closest* to where this field's own boxes should be — not just any
    row that falls inside a generous fixed band. A dense form (columns of
    fields stacked ~27pt apart) can have a neighboring field's row still
    inside a loose band, which silently grabs the wrong row instead of
    erroring; distance-ranking picks the field's own row even when a
    neighbor's is also in reach.

    `near` is the label's own bbox (x0, x1, top, bottom) from find_label.
    """
    lx0, lx1, ltop, lbottom = near
    label_mid_y = (ltop + lbottom) / 2

    if direction == "right":
        x_start, x_end = lx1, lx1 + search_width
        target_y = label_mid_y
    elif direction == "below":
        x_start, x_end = lx0 - 20, lx0 + search_width
        target_y = lbottom
    else:
        raise ValueError(f"unknown direction: {direction!r}")

    candidates = [
        (x, top, bottom) for (x, top, bottom) in _vertical_walls(page)
        if x_start - 5 <= x <= x_end
    ]
    if not candidates:
        return []

    rows = {}
    for x, top, bottom in candidates:
        rows.setdefault((round(top, 1), round(bottom, 1)), []).append(x)
    (row_top, row_bottom), _ = min(
        rows.items(),
        key=lambda kv: abs((kv[0][0] + kv[0][1]) / 2 - target_y),
    )
    xs = sorted({
        round(x, 2) for (x, top, bottom) in candidates
        if abs(top - row_top) <= y_tolerance and abs(bottom - row_bottom) <= y_tolerance
    })

    spans = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    plausible = [w for w in spans if min_box_width <= w <= max_box_width]
    if not plausible:
        return []
    width_counts = Counter(round(w * 2) / 2 for w in plausible)  # 0.5pt buckets
    modal_width, _ = width_counts.most_common(1)[0]
    tolerance = max(2.0, modal_width * width_tolerance)

    boxes = []
    for i in range(len(xs) - 1):
        w = xs[i + 1] - xs[i]
        if min_box_width <= w <= max_box_width and abs(w - modal_width) <= tolerance:
            boxes.append(Box(xs[i], xs[i + 1], row_top, row_bottom))
    return boxes


# ---------------------------------------------------------------------------
# Field specs + the fill/write pipeline
# ---------------------------------------------------------------------------


@dataclass
class FieldSpec:
    label: str
    value: str = ""
    checkbox: bool = False
    direction: str = "right"
    occurrence: int = 0  # which match of `label` on the page — a label
    # repeated across sections ("Date of Test:" under cholesterol, under
    # glucose/A1c, under blood pressure) needs this to disambiguate
    box_count: int | None = None  # None = every box detected in the row
    box_offset: int = 0  # how many boxes to skip first — for month/day/
    # year all sitting behind one shared label, e.g. month is
    # box_count=2 box_offset=0, day is box_count=2 box_offset=2, year is
    # box_count=4 box_offset=4
    search_width: float = 320  # how far past the label to look for boxes —
    # on a dense multi-column form the next field's boxes can sit well
    # inside the default, so the search pulls in the wrong group; narrow
    # this per-field once you've looked at how far the real boxes go
    skip: bool = False
    note: str = ""


@dataclass
class FillResult:
    field: FieldSpec
    ok: bool
    reason: str = ""


def fill_flat_form(
    pdf_path: str,
    fields: list[FieldSpec],
    out_path: str,
    page_number: int = 0,
) -> list[FillResult]:
    """Fill a flat (non-AcroForm) PDF. One FillResult per field, always —
    a field that couldn't be placed comes back ok=False with why, never
    silently dropped. Verify the output visually before treating a form
    like this as ready to send; this finds boxes, it doesn't understand
    the form."""
    results: list[FillResult] = []

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_number]
        page_w, page_h = float(page.width), float(page.height)

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(page_w, page_h))
        c.setFont("Helvetica", 11)

        def to_pdf_y(top: float, bottom: float, pad: float = 3.0) -> float:
            return page_h - (top + bottom) / 2 - pad

        for spec in fields:
            if spec.skip:
                results.append(FillResult(spec, ok=True, reason="skipped by request"))
                continue

            label_bbox = find_label(page, spec.label, occurrence=spec.occurrence)
            if label_bbox is None:
                reason = (
                    "label not found" if spec.occurrence == 0
                    else f"label not found at occurrence {spec.occurrence} "
                         f"(check how many times it actually appears)"
                )
                results.append(FillResult(spec, ok=False, reason=reason))
                continue

            all_boxes = find_box_rows(
                page, label_bbox, direction=spec.direction, search_width=spec.search_width,
            )
            count = spec.box_count if spec.box_count is not None else len(all_boxes)
            boxes = all_boxes[spec.box_offset:spec.box_offset + count]
            if not boxes:
                results.append(FillResult(
                    spec, ok=False,
                    reason=f"no boxes at offset {spec.box_offset} "
                           f"({len(all_boxes)} detected near label)",
                ))
                continue

            if spec.checkbox:
                box = boxes[0]
                c.setFont("Helvetica-Bold", 11)
                c.drawCentredString(box.cx, to_pdf_y(box.top, box.bottom), "X")
                c.setFont("Helvetica", 11)
                results.append(FillResult(spec, ok=True))
                continue

            digits = spec.value.replace(".", "").replace("-", "")
            slots = digits.rjust(len(boxes))[-len(boxes):]
            for box, ch in zip(boxes, slots):
                if ch != " ":
                    c.drawCentredString(box.cx, to_pdf_y(box.top, box.bottom), ch)
            results.append(FillResult(spec, ok=True))

        c.showPage()
        c.save()

    buf.seek(0)
    overlay_reader = PdfReader(buf)
    writer = PdfWriter()
    writer.append(pdf_path)  # clone all pages into the writer first — merging
    writer.pages[page_number].merge_page(overlay_reader.pages[0])  # onto an
    # unattached page is deprecated as of pypdf 6.x, removed in 7.0
    with open(out_path, "wb") as f:
        writer.write(f)

    return results
