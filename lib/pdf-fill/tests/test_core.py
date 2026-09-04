"""pdf_fill.core tests, against synthetic PDFs built with reportlab so
nothing here depends on an external fixture file."""

from __future__ import annotations

import pdfplumber
import pytest
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from pdf_fill.core import (
    FieldSpec,
    acroform_field_names,
    fill_acroform,
    fill_flat_form,
    find_box_rows,
    find_label,
    has_acroform,
)

PAGE_W, PAGE_H = 600, 800


def _draw_boxes(c, x0, y0, count, box_w=16, box_h=20):
    """count adjoining boxes starting at (x0, y0), reportlab (bottom-up)
    coordinates. Returns the x1 of the last box, for chaining a next group."""
    for i in range(count):
        c.rect(x0 + i * box_w, y0, box_w, box_h, stroke=1, fill=0)
    return x0 + count * box_w


def make_flat_form(path):
    """A synthetic flat form: a single-group field, a checkbox, and a
    three-group compound field behind one label (month/day/year), the same
    shape as the real physician form that motivated this tool."""
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H))
    c.setFont("Helvetica", 11)

    # Single-group numeric field: "Total Cholesterol" + 3 boxes
    c.drawString(50, 700, "Total Cholesterol")
    _draw_boxes(c, 220, 693, 3)

    # Checkbox: "Patient fasting?" + one box
    c.drawString(50, 650, "Patient fasting?")
    _draw_boxes(c, 220, 643, 1)

    # Compound field: "Date of Test" + three separate box groups
    # (month: 2, gap, day: 2, gap, year: 4) with real gaps between them.
    c.drawString(50, 600, "Date of Test")
    x = _draw_boxes(c, 220, 593, 2)          # month
    x = _draw_boxes(c, x + 25, 593, 2)        # day (25pt gap)
    _draw_boxes(c, x + 25, 593, 4)             # year (25pt gap)

    c.showPage()
    c.save()


def make_acroform_pdf(path):
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H))
    c.setFont("Helvetica", 11)
    c.drawString(50, 700, "Name:")
    form = c.acroForm
    form.textfield(name="patient_name", x=150, y=690, width=200, height=20,
                    borderStyle="inset")
    c.showPage()
    c.save()


@pytest.fixture
def flat_pdf(tmp_path):
    path = tmp_path / "flat.pdf"
    make_flat_form(path)
    return path


@pytest.fixture
def acroform_pdf(tmp_path):
    path = tmp_path / "acroform.pdf"
    make_acroform_pdf(path)
    return path


# ---------- find_label ----------

def test_find_label_locates_a_single_word(flat_pdf):
    with pdfplumber.open(flat_pdf) as pdf:
        bbox = find_label(pdf.pages[0], "Patient fasting?")
    assert bbox is not None


def test_find_label_locates_a_multi_word_phrase(flat_pdf):
    with pdfplumber.open(flat_pdf) as pdf:
        bbox = find_label(pdf.pages[0], "Total Cholesterol")
    assert bbox is not None


def test_find_label_returns_none_when_absent(flat_pdf):
    with pdfplumber.open(flat_pdf) as pdf:
        assert find_label(pdf.pages[0], "Nonexistent Field") is None


def test_find_label_occurrence_disambiguates_a_repeated_label(tmp_path):
    # The real motivating case: "Date of Test:" appears three times on the
    # actual physician form (cholesterol / glucose / blood pressure
    # sections) — occurrence=0 must not silently win every time.
    path = tmp_path / "repeated.pdf"
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H))
    c.setFont("Helvetica", 11)
    c.drawString(50, 700, "Date of Test:")
    c.drawString(50, 600, "Date of Test:")
    c.showPage()
    c.save()

    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        first = find_label(page, "Date of Test", occurrence=0)
        second = find_label(page, "Date of Test", occurrence=1)
        third = find_label(page, "Date of Test", occurrence=2)
    assert first is not None and second is not None
    assert first[2] < second[2]  # first occurrence is higher on the page (smaller `top`)
    assert third is None  # only two exist


# ---------- find_box_rows ----------

def test_find_box_rows_detects_three_boxes(flat_pdf):
    with pdfplumber.open(flat_pdf) as pdf:
        page = pdf.pages[0]
        label = find_label(page, "Total Cholesterol")
        boxes = find_box_rows(page, label)
    assert len(boxes) == 3


def test_find_box_rows_returns_every_box_of_a_compound_field_undivided(flat_pdf):
    # month(2) + day(2) + year(4) = 8 boxes, left to right, with no attempt
    # to guess where one field's boxes end and the next's begin — that's
    # what box_count/box_offset are for, tested via fill_flat_form below.
    with pdfplumber.open(flat_pdf) as pdf:
        page = pdf.pages[0]
        label = find_label(page, "Date of Test")
        boxes = find_box_rows(page, label)
    assert len(boxes) == 8


# ---------- fill_flat_form ----------

def test_fill_flat_form_places_a_simple_numeric_value(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    results = fill_flat_form(
        str(flat_pdf), [FieldSpec(label="Total Cholesterol", value="149")], str(out)
    )
    assert results[0].ok
    assert out.exists()


def test_fill_flat_form_places_a_checkbox(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    results = fill_flat_form(
        str(flat_pdf), [FieldSpec(label="Patient fasting?", checkbox=True)], str(out)
    )
    assert results[0].ok


def test_fill_flat_form_addresses_each_group_of_a_compound_field(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    specs = [
        FieldSpec(label="Date of Test", value="02", box_count=2, box_offset=0),
        FieldSpec(label="Date of Test", value="12", box_count=2, box_offset=2),
        FieldSpec(label="Date of Test", value="2026", box_count=4, box_offset=4),
    ]
    results = fill_flat_form(str(flat_pdf), specs, str(out))
    assert all(r.ok for r in results)


def test_fill_flat_form_box_offset_past_the_end_fails_cleanly(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    results = fill_flat_form(
        str(flat_pdf),
        [FieldSpec(label="Date of Test", value="99", box_count=2, box_offset=20)],
        str(out),
    )
    assert not results[0].ok
    assert "no boxes" in results[0].reason


def test_fill_flat_form_reports_failure_without_dropping_the_field(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    results = fill_flat_form(
        str(flat_pdf), [FieldSpec(label="Not On The Form", value="x")], str(out)
    )
    assert len(results) == 1
    assert not results[0].ok
    assert "not found" in results[0].reason


def test_fill_flat_form_honors_skip(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    results = fill_flat_form(
        str(flat_pdf),
        [FieldSpec(label="Total Cholesterol", skip=True, note="physician-only")],
        str(out),
    )
    assert results[0].ok
    assert results[0].reason == "skipped by request"


def test_fill_flat_form_writes_a_readable_pdf_with_the_right_page_count(flat_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    fill_flat_form(str(flat_pdf), [FieldSpec(label="Total Cholesterol", value="149")], str(out))
    assert len(PdfReader(str(out)).pages) == 1


# ---------- AcroForm path ----------

def test_has_acroform_true_for_a_real_form(acroform_pdf):
    assert has_acroform(str(acroform_pdf)) is True


def test_has_acroform_false_for_a_flat_pdf(flat_pdf):
    assert has_acroform(str(flat_pdf)) is False


def test_acroform_field_names_lists_the_real_field(acroform_pdf):
    assert "patient_name" in acroform_field_names(str(acroform_pdf))


def test_fill_acroform_sets_the_value(acroform_pdf, tmp_path):
    out = tmp_path / "out.pdf"
    fill_acroform(str(acroform_pdf), {"patient_name": "Joseph Severino"}, str(out))
    fields = PdfReader(str(out)).get_fields()
    assert fields["patient_name"]["/V"] == "Joseph Severino"
