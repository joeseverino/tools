# pdf-fill

Fill a PDF form two ways:

- **AcroForm** (real fillable fields) — filled directly by field name.
- **Flat/scanned form** (drawn boxes, no field objects — a printed form
  that got scanned) — filled by finding each label's printed text, finding
  the row of boxes near it, and drawing one character per box.

Built against the 2026 US Wellness physician form (a real 3-column flat
form with repeated labels, wrapped captions, and box rows only ~27pt
apart) — the geometry problems it solves came from that form, not a
hypothetical one.

## Usage

```
pdf-fill has-form <pdf>                          # does it have real AcroForm fields?
pdf-fill acroform-fields <pdf>                    # list fillable field names
pdf-fill fill-acroform <pdf> <fields.json> <out.pdf>
pdf-fill fill-flat <pdf> <fields.json> <out.pdf> [--page N]
```

Run via `bin/pdf-fill` from the tools repo root, or directly:
`uv run --project lib/pdf-fill pdf-fill <cmd> ...`

### fill-acroform

`fields.json` is `{"Field Name": "value", ...}` — field names come from
`acroform-fields`.

### fill-flat

`fields.json` is a list of field specs:

```json
[
  {"label": "Total Cholesterol", "value": "149"},
  {"label": "Patient fasting?", "checkbox": true},
  {"label": "Date of Test", "value": "08", "occurrence": 0, "box_count": 2, "box_offset": 0},
  {"label": "Date of Test", "value": "10", "occurrence": 0, "box_count": 2, "box_offset": 2},
  {"label": "Date of Test", "value": "2026", "occurrence": 0, "box_count": 4, "box_offset": 4},
  {"label": "Systolic", "value": "110", "direction": "right", "search_width": 140},
  {"label": "Healthcare provider name", "skip": true}
]
```

Each spec:

| field | meaning |
|---|---|
| `label` | the printed caption to anchor on |
| `value` | digits to place, right-justified into however many boxes are addressed |
| `checkbox` | draw an "X" centered in the first addressed box instead of digits |
| `occurrence` | which instance of a repeated label (0-indexed, top-to-bottom) |
| `direction` | `"right"` (boxes beside the label) or `"below"` (boxes under it) |
| `search_width` | how far past the label to look for boxes — narrow this on a dense multi-column form so the search doesn't reach into a neighboring field |
| `box_count` / `box_offset` | which boxes belong to this field, when one label fronts more than one group (month/day/year all behind one "Date of Test:" label) |
| `skip` | leave this field alone on purpose (e.g. it needs an actual person's signature) — still shows up in the result report, not silently missing |

`fill-flat` always prints one result per field — `OK`/`FAIL` and why —
and exits nonzero if anything failed. **Render the output and look at it**
before treating a filled form as done; this finds boxes, it doesn't
understand the form. A quick way:

```
pdftoppm -png -r 200 out.pdf out && open out-1.png
```

### Design notes, from what actually broke against a real form

- **Box width vs. gap width are close.** A form's individual boxes and the
  gaps between separate field-groups behind one label can differ by only
  ~30% — too close for a fixed cutoff. `find_box_rows` uses the *modal*
  box width in a row and keeps only spans within a relative tolerance of
  it.
- **Rows can sit close together.** On a dense form, rows only ~27pt apart
  put a neighboring field's boxes inside what looks like a safe search
  band. Row selection picks whichever candidate row is vertically
  *closest* to the label, not just any row that falls inside a loose
  fixed band — otherwise a field can silently grab its neighbor's boxes.
- **Labels repeat.** "Date of Test:" can appear once per section (three
  times on the physician form). `occurrence` picks which instance.
- **Labels wrap across lines.** A caption too wide for its column
  (`"Total Cholesterol"` → `"Total"` / `"Cholesterol"` on two lines) still
  needs to resolve as one label. `find_label` falls back to matching
  across two lines, left-aligned, when no single line has the full
  phrase.
- **Column layout, not just spacing, decides `direction`.** Some fields'
  boxes sit beside the label, others below it — you have to look at the
  form.

## Tests

```
cd lib/pdf-fill && uv run --with pytest pytest -q
```
