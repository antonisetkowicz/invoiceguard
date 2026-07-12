#!/usr/bin/env python3
"""Generate a 1-page case study PDF from a JSON brief.

Usage:
    python generate_case_study.py input.json [-o output.pdf]
    python generate_case_study.py *.json -o out_dir/          # batch mode
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph

PAGE_W, PAGE_H = A4
MARGIN = 42
CONTENT_W = PAGE_W - 2 * MARGIN

FONTS_DIR = Path(__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("DejaVuSans", FONTS_DIR / "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", FONTS_DIR / "DejaVuSans-Bold.ttf"))

NAVY = HexColor("#0f172a")
NAVY_LIGHT = HexColor("#1e293b")
RED = HexColor("#ef4444")
BLUE = HexColor("#3b82f6")
GREEN = HexColor("#10b981")
GRAY_TEXT = HexColor("#334155")
GRAY_MUTED = HexColor("#64748b")
GRAY_LINE = HexColor("#e2e8f0")
PILL_BG = HexColor("#f1f5f9")

FONT_REGULAR = "DejaVuSans"
FONT_BOLD = "DejaVuSans-Bold"

REQUIRED_FIELDS = ["project_name", "problem", "solution", "results", "tech_stack"]

BODY_STYLE = ParagraphStyle(
    "Body",
    fontName=FONT_REGULAR,
    fontSize=10.5,
    leading=15,
    textColor=GRAY_TEXT,
    alignment=TA_LEFT,
)

RESULT_STYLE = ParagraphStyle(
    "Result",
    fontName=FONT_REGULAR,
    fontSize=10.5,
    leading=14,
    textColor=NAVY,
    alignment=TA_LEFT,
)


def load_case_study(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    missing = [field for field in REQUIRED_FIELDS if field not in data]
    if missing:
        raise ValueError(f"{path}: brakuje wymaganych pól w JSON: {', '.join(missing)}")
    if not isinstance(data["results"], list) or not data["results"]:
        raise ValueError(f"{path}: 'results' musi być niepustą listą")
    if not isinstance(data["tech_stack"], list) or not data["tech_stack"]:
        raise ValueError(f"{path}: 'tech_stack' musi być niepustą listą")

    return data


def draw_paragraph(c: canvas.Canvas, text: str, x: float, top_y: float, width: float, style: ParagraphStyle) -> float:
    """Draws a wrapped paragraph starting at (x, top_y) and returns the new top y."""
    p = Paragraph(text, style)
    _, h = p.wrap(width, 1000)
    p.drawOn(c, x, top_y - h)
    return top_y - h


def draw_header(c: canvas.Canvas, project_name: str) -> float:
    header_h = 96
    header_top = PAGE_H
    c.setFillColor(NAVY)
    c.rect(0, header_top - header_h, PAGE_W, header_h, stroke=0, fill=1)

    # subtle accent stripe
    c.setFillColor(HexColor("#312e81"))
    c.rect(0, header_top - header_h, PAGE_W, 4, stroke=0, fill=1)

    # logo placeholder: rounded initials badge
    initials = "".join(word[0] for word in project_name.split()[:2]).upper() or "?"
    badge_size = 46
    badge_x, badge_y = MARGIN, header_top - header_h / 2 - badge_size / 2
    c.setFillColor(HexColor("#6366f1"))
    c.roundRect(badge_x, badge_y, badge_size, badge_size, 10, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_BOLD, 16)
    c.drawCentredString(badge_x + badge_size / 2, badge_y + badge_size / 2 - 5, initials)

    text_x = badge_x + badge_size + 16
    c.setFillColor(white)
    c.setFont(FONT_BOLD, 21)
    c.drawString(text_x, header_top - header_h / 2 + 4, project_name)
    c.setFillColor(HexColor("#a5b4fc"))
    c.setFont(FONT_REGULAR, 9.5)
    c.drawString(text_x, header_top - header_h / 2 - 12, "AI AUTOMATION CASE STUDY")

    # "CASE STUDY" pill top-right
    pill_text = "CASE STUDY"
    c.setFont(FONT_BOLD, 8)
    pill_w = c.stringWidth(pill_text, FONT_BOLD, 8) + 20
    pill_h = 20
    pill_x = PAGE_W - MARGIN - pill_w
    pill_y = header_top - header_h / 2 - pill_h / 2
    c.setFillColor(HexColor("#4338ca"))
    c.roundRect(pill_x, pill_y, pill_w, pill_h, pill_h / 2, stroke=0, fill=1)
    c.setFillColor(white)
    c.drawCentredString(pill_x + pill_w / 2, pill_y + pill_h / 2 - 3, pill_text)

    return header_top - header_h


def draw_section_label(c: canvas.Canvas, label: str, accent: HexColor, x: float, y: float) -> None:
    c.setFillColor(accent)
    c.rect(x, y - 12, 4, 16, stroke=0, fill=1)
    c.setFont(FONT_BOLD, 12)
    c.setFillColor(NAVY)
    c.drawString(x + 12, y - 8, label)


def draw_results_section(c: canvas.Canvas, results: list[str], x: float, top_y: float, width: float) -> float:
    draw_section_label(c, "EFEKTY", GREEN, x, top_y)
    y = top_y - 30
    circle_r = 12
    text_x = x + 2 * circle_r + 14
    text_w = width - (2 * circle_r + 14)

    for idx, result in enumerate(results, start=1):
        p = Paragraph(result, RESULT_STYLE)
        _, h = p.wrap(text_w, 1000)
        row_h = max(h, 2 * circle_r)

        circle_cy = y - row_h / 2
        c.setFillColor(GREEN)
        c.circle(x + circle_r, circle_cy, circle_r, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 10.5)
        c.drawCentredString(x + circle_r, circle_cy - 3.5, str(idx))

        p.drawOn(c, text_x, y - h)

        y -= row_h + 14

    return y


def draw_footer(c: canvas.Canvas, tech_stack: list[str]) -> None:
    footer_top = 92
    c.setStrokeColor(GRAY_LINE)
    c.setLineWidth(1)
    c.line(MARGIN, footer_top, PAGE_W - MARGIN, footer_top)

    c.setFont(FONT_BOLD, 9)
    c.setFillColor(GRAY_MUTED)
    c.drawString(MARGIN, footer_top - 18, "TECH STACK")

    x = MARGIN
    y = footer_top - 40
    pill_h = 20
    gap = 8
    c.setFont(FONT_REGULAR, 9.5)

    for tech in tech_stack:
        pill_w = c.stringWidth(tech, FONT_REGULAR, 9.5) + 20
        if x + pill_w > PAGE_W - MARGIN:
            x = MARGIN
            y -= pill_h + gap
        c.setFillColor(PILL_BG)
        c.roundRect(x, y - pill_h, pill_w, pill_h, pill_h / 2, stroke=0, fill=1)
        c.setFillColor(NAVY_LIGHT)
        c.drawCentredString(x + pill_w / 2, y - pill_h / 2 - 3.5, tech)
        x += pill_w + gap

    c.setFont(FONT_REGULAR, 7.5)
    c.setFillColor(GRAY_MUTED)
    c.drawRightString(PAGE_W - MARGIN, 30, "Wygenerowano automatycznie – demo automatyzacji AI")


def build_pdf(data: dict, output_path: Path) -> None:
    c = canvas.Canvas(str(output_path), pagesize=A4)
    c.setTitle(f"Case Study – {data['project_name']}")

    y = draw_header(c, data["project_name"])
    y -= 34

    draw_section_label(c, "PROBLEM", RED, MARGIN, y)
    y = draw_paragraph(c, data["problem"], MARGIN, y - 30, CONTENT_W, BODY_STYLE)
    y -= 28

    draw_section_label(c, "ROZWIĄZANIE", BLUE, MARGIN, y)
    y = draw_paragraph(c, data["solution"], MARGIN, y - 30, CONTENT_W, BODY_STYLE)
    y -= 28

    draw_results_section(c, data["results"], MARGIN, y, CONTENT_W)

    draw_footer(c, data["tech_stack"])

    c.showPage()
    c.save()


def resolve_output_path(input_path: Path, output_arg: Path | None) -> Path:
    if output_arg is None:
        return input_path.with_suffix(".pdf")
    if output_arg.suffix.lower() == ".pdf":
        return output_arg
    output_arg.mkdir(parents=True, exist_ok=True)
    return output_arg / input_path.with_suffix(".pdf").name


def main() -> int:
    parser = argparse.ArgumentParser(description="Generuje 1-stronicowe case studies PDF z pliku(ów) JSON")
    parser.add_argument("inputs", nargs="+", type=Path, help="Ścieżka(i) do pliku JSON z opisem case study")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Ścieżka pliku wyjściowego PDF (dla jednego wejścia) lub katalog wyjściowy (dla wielu)",
    )
    args = parser.parse_args()

    if len(args.inputs) > 1 and args.output is not None and args.output.suffix.lower() == ".pdf":
        parser.error("--output musi być katalogiem, gdy podano wiele plików wejściowych")

    for input_path in args.inputs:
        try:
            data = load_case_study(input_path)
            output_path = resolve_output_path(input_path, args.output)
            build_pdf(data, output_path)
            print(f"OK  {input_path} -> {output_path}")
        except (ValueError, json.JSONDecodeError, OSError) as exc:
            print(f"BŁĄD podczas przetwarzania {input_path}: {exc}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
