
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pymupdf
import pytest
from docx import Document as Word
from openpyxl import Workbook

from app.demo import create_pdf
from app.embeddings import encode, split
from app.parsing import FORMATS, DocumentError, PdfOCR, Section, parse, validate
from app.reports import render_report
from app.workbench import diff

SCAN = Path(__file__).parent / "fixtures" / "scanned-contract.pdf"


def test_utf8_and_mime():
    raw = "Оплата — 10 дней.\n\nСрок действия — месяц.".encode()
    assert validate(raw, "txt", "text/plain; charset=utf-8") == "text/plain"
    sections, pages = parse(raw, "txt", 1000)
    assert sections == [Section("Оплата — 10 дней.", "Абзац 1"), Section("Срок действия — месяц.", "Абзац 2")]
    assert pages is None
    with pytest.raises(DocumentError, match="расширению"):
        validate(raw, "txt", "image/png")
    with pytest.raises(DocumentError, match="двоичные"):
        validate(b"Hello\x00", "txt", None)
    with pytest.raises(DocumentError, match="UTF-8"):
        validate(b"\xff", "md", None)


def test_pdf_pages_and_scans():
    raw = create_pdf("Срок оплаты — 10 рабочих дней")
    assert validate(raw, "pdf", None) == "application/pdf"
    sections, pages = parse(raw, "pdf", 1000)
    assert sections == [Section("Срок оплаты — 10 рабочих дней", "Страница 1", 1)]
    assert pages == 1
    with pymupdf.open() as pdf:
        pdf.new_page()
        with pytest.raises(DocumentError, match="OCR"):
            parse(pdf.tobytes(), "pdf", 1000)
        encrypted = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
        with pytest.raises(DocumentError, match="паролем"):
            parse(encrypted, "pdf", 1000)


def test_ocr_preserves_page_number_and_native_text():
    with pymupdf.open(SCAN) as scan, pymupdf.open(stream=create_pdf("Исходный текст"), filetype="pdf") as mixed:
        assert not scan[0].get_text().strip()
        mixed.insert_pdf(scan)
        raw = mixed.tobytes()
    sections, page_count = parse(raw, "pdf", 1000, ocr=PdfOCR("rus+eng", 1, 15, 30))
    assert page_count == 2
    assert sections[0] == Section("Исходный текст", "Страница 1", 1)
    assert sections[1].location == "Страница 2 · OCR"
    assert sections[1].page == 2
    assert sections[1].recognized
    assert "10 рабочих дней" in sections[1].text
    assert "Payment reference" in sections[1].text


def test_ocr_honors_disable_switch_and_page_limit():
    raw = SCAN.read_bytes()
    with pytest.raises(DocumentError, match="включите OCR"):
        parse(raw, "pdf", 1000)
    with pymupdf.open(SCAN) as scan, pymupdf.open() as repeated:
        repeated.insert_pdf(scan)
        repeated.insert_pdf(scan)
        with pytest.raises(DocumentError, match="Лимит OCR — 1"):
            parse(repeated.tobytes(), "pdf", 1000, ocr=PdfOCR("rus+eng", 1, 15, 30))


def test_docx_and_spreadsheets():
    document = Word()
    document.add_paragraph("Акт приёмки")
    document.add_table(rows=1, cols=1).cell(0, 0).text = "Итого"
    buffer = BytesIO()
    document.save(buffer)
    raw = buffer.getvalue()
    assert validate(raw, "docx", "application/zip") == FORMATS["docx"]
    items, _ = parse(raw, "docx", 1000)
    assert [item.location for item in items] == ["Абзац 1", "Таблица 1, строка 1"]

    book = Workbook()
    book.active.title = "Смета"
    book.active.append(["Вёрстка", 45000])
    buffer = BytesIO()
    book.save(buffer)
    raw = buffer.getvalue()
    assert validate(raw, "xlsx", FORMATS["xlsx"]) == FORMATS["xlsx"]
    rows, _ = parse(raw, "xlsx", 1000)
    assert rows == [Section("Вёрстка | 45000", "Смета, строка 1")]
    csv, _ = parse("Услуга;Цена\nВёрстка;45000\n".encode(), "csv", 1000)
    assert csv[1] == Section("Вёрстка | 45000", "Строка 2")


def test_office_path_validation():
    archive = BytesIO()
    with ZipFile(archive, "w") as file:
        file.writestr("../evil", "data")
        file.writestr("word/document.xml", "data")
        file.writestr("[Content_Types].xml", "data")
    with pytest.raises(DocumentError, match="путь"):
        validate(archive.getvalue(), "docx", None)


def test_chunk_overlap_and_vector_size():
    words = " ".join(f"item{i}" for i in range(14))
    parts = split([Section(words, "Страница 2", 2)], 6, 2)
    assert [part.text.split()[0] for part in parts] == ["item0", "item4", "item8"]
    assert parts[-1].text.endswith("item13")
    assert all(part.page == 2 for part in parts)
    vec = encode(["оплата в течение срока"], query=True)[0]
    assert len(vec) == 384
    assert sum(x*x for x in vec) == pytest.approx(1)


def test_diff_keeps_line_numbers():
    changes = diff("Договор\nСумма: 120\nНе менять", "Договор\nСумма: 140\nНе менять\nНовый пункт")
    assert changes["counts"] == {"added": 1, "removed": 0, "changed": 1}
    assert changes["items"][0] == {"kind": "changed", "before": "Сумма: 120", "after": "Сумма: 140",
                                   "before_line": 2, "after_line": 2}


@pytest.mark.parametrize("format", ["pdf", "docx", "md"])
def test_cyrillic_reports(format):
    data = {"summary": "Срок оплаты — десять дней.", "findings": [
        {"title": "Условие", "detail": "Пункт договора.", "sources": [1]}]}
    raw, _ = render_report(format, "Договор", "Сравнение", datetime.now(UTC), data, "Проверка")
    if format == "pdf":
        with pymupdf.open(stream=raw, filetype="pdf") as pdf:
            assert "Срок оплаты" in pdf[0].get_text()
    elif format == "docx":
        assert Word(BytesIO(raw)).tables[0].cell(1, 0).text == "Срок оплаты — десять дней."
    else:
        assert "| Срок оплаты — десять дней. |" in raw.decode()
