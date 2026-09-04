"""pdf_fill.cli tests — exercises main() end-to-end so a bug in the print/
report path (e.g. referencing a FieldSpec attribute that no longer exists)
fails a test instead of only showing up the next time someone runs the
tool for real."""

from __future__ import annotations

import json

from reportlab.pdfgen import canvas

from pdf_fill.cli import main

PAGE_W, PAGE_H = 600, 800


def _make_flat_pdf(path):
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H))
    c.setFont("Helvetica", 11)
    c.drawString(50, 700, "Total Cholesterol")
    for i in range(3):
        c.rect(220 + i * 16, 693, 16, 20, stroke=1, fill=0)
    c.showPage()
    c.save()
    return path


def test_fill_flat_cli_reports_ok_field_without_crashing(tmp_path, capsys):
    pdf = _make_flat_pdf(tmp_path / "flat.pdf")
    fields_json = tmp_path / "fields.json"
    fields_json.write_text(json.dumps([
        {"label": "Total Cholesterol", "value": "149", "box_count": 3, "box_offset": 0},
    ]))
    out_pdf = tmp_path / "out.pdf"

    rc = main(["fill-flat", str(pdf), str(fields_json), str(out_pdf)])

    assert rc == 0
    assert out_pdf.exists()
    captured = capsys.readouterr()
    assert "OK" in captured.out
    assert "occurrence 0" in captured.out
    assert "offset 0" in captured.out


def test_fill_flat_cli_reports_failed_field_with_nonzero_exit(tmp_path, capsys):
    pdf = _make_flat_pdf(tmp_path / "flat.pdf")
    fields_json = tmp_path / "fields.json"
    fields_json.write_text(json.dumps([
        {"label": "Not On The Form", "value": "x"},
    ]))
    out_pdf = tmp_path / "out.pdf"

    rc = main(["fill-flat", str(pdf), str(fields_json), str(out_pdf)])

    assert rc == 1
    captured = capsys.readouterr()
    assert "FAIL" in captured.out
