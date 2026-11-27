
import io
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

from docx import Document
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

from app.config import settings

CONTRACT_FIELDS = {
    "document_type": "Тип документа", "parties": "Стороны", "subject": "Предмет договора",
    "price": "Стоимость", "term": "Срок действия", "payment": "Условия оплаты",
    "obligations": "Обязательства", "liability": "Ответственность", "penalties": "Штрафы",
    "termination": "Расторжение", "unclear": "Неясные условия",
    "specialist_questions": "Вопросы для специалиста",
}
LEVELS = {"low": "Низкий", "medium": "Средний", "high": "Высокий"}
CHANGES = {"added": "Добавлено", "removed": "Удалено", "changed": "Изменено"}


def sections(data: dict):
    if data.get("summary"):
        yield "Резюме", [["Результат"], [data["summary"]]]
    if "counts" in data:
        yield "Всего изменений", [["Тип", "Количество"], *[
            [label, str(data["counts"][key])] for key, label in CHANGES.items()]]
        if data["items"]:
            yield "Изменения", [["Тип", "Исходная версия", "Новая версия"], *[
                [CHANGES[item["kind"]], (f'{item["before_line"]}: ' + item["before"]) if item["before_line"] else "—",
                 (f'{item["after_line"]}: ' + item["after"]) if item["after_line"] else "—"] for item in data["items"]]]
    if data.get("findings"):
        yield "Выводы", [["Тема", "Описание", "Источники"], *[
            [item["title"], item["detail"], ", ".join(map(str, item["sources"]))] for item in data["findings"]]]
    contract = data.get("contract")
    if contract:
        yield "Условия договора", [["Условие", "Значение"], *[
            [label, "\n".join(value) if isinstance(value, list) else value or "Не найдено"]
            for field, label in CONTRACT_FIELDS.items() if (value := contract.get(field))]]
        if contract.get("risks"):
            yield "Потенциальные риски", [["Риск", "Уровень", "Описание", "Источники"], *[
                [item["title"], LEVELS[item["level"]], item["detail"], ", ".join(map(str, item["sources"]))]
                for item in contract["risks"]]]
    if data.get("sources"):
        yield "Источники", [["№", "Документ", "Фрагмент"], *[
            [str(source["number"]), source["name"], source["location"]] for source in data["sources"]]]


@lru_cache
def font():
    path = Path(settings().pdf_font_dir)
    pdfmetrics.registerFont(TTFont("DocuMindSans", str(path / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DocuMindBold", str(path / "DejaVuSans-Bold.ttf")))
    return "DocuMindSans"


def render_report(format: str, name: str, kind: str, created_at: datetime, data: dict, warning: str):
    timestamp = created_at.strftime("%d.%m.%Y %H:%M UTC")
    metadata = (name, kind, timestamp)
    contents = list(sections(data))
    if format == "md":
        def cell(value):
            return value.replace("|", "\\|").replace("\r", "").replace("\n", "<br>")
        lines = ["# DocuMind AI", *metadata, ""]
        for heading, rows in contents:
            lines += ["## " + heading, "| " + " | ".join(map(cell, rows[0])) + " |",
                      "| " + " | ".join("---" for _ in rows[0]) + " |"]
            lines += ["| " + " | ".join(map(cell, row)) + " |" for row in rows[1:]]
            lines.append("")
        lines.append(warning)
        block = "\n\n".join(lines[:5]).rstrip() + "\n\n" + "\n".join(lines[5:]) + "\n"
        return block.encode(), "text/markdown; charset=utf-8"

    output = io.BytesIO()
    if format == "docx":
        word = Document()
        word.add_heading("DocuMind AI", 0)
        for value in metadata:
            word.add_paragraph(value)
        for heading, rows in contents:
            word.add_heading(heading, 1)
            table = word.add_table(rows=0, cols=len(rows[0]))
            table.style = "Light Shading Accent 1"
            for row in rows:
                for value, target in zip(row, table.add_row().cells, strict=True):
                    target.text = value
        word.add_paragraph(warning)
        word.save(output)
        return output.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    paragraph = ParagraphStyle("Normal", fontName=font(), fontSize=9, leading=13, spaceAfter=5)
    heading = ParagraphStyle("Title", parent=paragraph, fontName="DocuMindBold", fontSize=15, leading=19, spaceBefore=12)
    table_heading = ParagraphStyle("Table heading", parent=paragraph, fontName="DocuMindBold")
    pdf = SimpleDocTemplate(output, title="DocuMind AI — " + name, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm)

    def sanitize(value: str):
        return escape(value).replace("\n", "<br/>")

    flow = [Paragraph("DocuMind AI", heading), *[Paragraph(sanitize(value), paragraph) for value in metadata]]
    for title, rows in contents:
        flow.append(Paragraph(sanitize(title), heading))
        columns = len(rows[0])
        table = LongTable([[Paragraph(sanitize(value), table_heading if index == 0 else paragraph) for value in row]
                           for index, row in enumerate(rows)], colWidths=[pdf.width / columns] * columns,
                          repeatRows=1, splitInRow=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeedfb")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d8d8e2")),
        ]))
        flow.extend([table, Spacer(1, 4 * mm)])
    flow.append(Paragraph(sanitize(warning), paragraph))
    pdf.build(flow)
    return output.getvalue(), "application/pdf"
