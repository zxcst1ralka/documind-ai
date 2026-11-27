
import csv
import io
import math
import re
import stat
import subprocess
from dataclasses import dataclass
from functools import partial
from pathlib import PurePosixPath
from time import monotonic
from zipfile import BadZipFile, ZipFile

import pymupdf
from docx import Document as Word
from docx.document import Document as WordDocument
from docx.table import Table
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook


class DocumentError(ValueError):
    pass


@dataclass(frozen=True)
class Section:
    text: str
    location: str
    page: int | None = None
    recognized: bool = False


@dataclass(frozen=True)
class PdfOCR:
    languages: str
    max_pages: int
    page_timeout: float
    document_timeout: float


FORMATS = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def decode_text(raw: bytes) -> str:
    try:
        result = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise DocumentError("Сохраните текстовый файл в кодировке UTF-8.") from exc
    if any(ord(char) < 32 and char not in "\n\r\t\f" for char in result):
        raise DocumentError("Файл содержит двоичные данные.")
    return result


def validate_archive(raw: bytes, extension: str):
    if not raw.startswith(b"PK\x03\x04"):
        raise DocumentError("Сигнатура файла не соответствует формату Office.")
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 4000 or sum(part.file_size for part in entries) > 75 * 1024**2:
                raise DocumentError("Внутренний архив файла слишком велик.")
            names = set()
            for part in entries:
                name = PurePosixPath(part.filename)
                if (name.is_absolute() or ".." in name.parts or "\\" in part.filename
                        or ":" in part.filename or stat.S_ISLNK(part.external_attr >> 16)):
                    raise DocumentError("Недопустимый путь внутри файла Office.")
                if part.flag_bits & 1:
                    raise DocumentError("Файлы с паролем не поддерживаются.")
                if part.file_size > 20 * 1024**2 or part.filename in names:
                    raise DocumentError("Некорректная структура файла Office.")
                names.add(part.filename)
            main = "word/document.xml" if extension == "docx" else "xl/workbook.xml"
            if not {"[Content_Types].xml", main}.issubset(names):
                raise DocumentError("Структура файла не соответствует расширению.")
    except BadZipFile as exc:
        raise DocumentError("Не удалось прочитать внутренний архив файла.") from exc


def validate(raw: bytes, extension: str, content_type: str | None) -> str:
    mime = FORMATS.get(extension)
    if not mime:
        raise DocumentError("Этот формат не поддерживается.")
    if not raw:
        raise DocumentError("Файл пуст.")
    aliases = {
        "txt": {"text/plain"}, "md": {"text/plain", "text/x-markdown"},
        "csv": {"text/plain", "application/csv", "application/vnd.ms-excel"},
        "docx": {"application/zip"}, "xlsx": {"application/zip"},
    }
    given = (content_type or "").split(";")[0].strip().lower()
    if given not in {"", "application/octet-stream", mime, *aliases.get(extension, set())}:
        raise DocumentError("Тип содержимого не соответствует расширению файла.")
    if extension == "pdf":
        if not raw.startswith(b"%PDF-"):
            raise DocumentError("Сигнатура файла не соответствует PDF.")
    elif extension in {"docx", "xlsx"}:
        validate_archive(raw, extension)
    else:
        decode_text(raw)
    return mime


def clean(value: str) -> str:
    return re.sub(r"[\x00-\x08\x0b-\x0c\x0e-\x1f]", "", value).strip()


def recognize_page(page: pymupdf.Page, languages: str, timeout: float) -> str:
    deadline = monotonic() + timeout
    width, height = page.rect.width, page.rect.height
    if not all(math.isfinite(length) and length > 0 for length in (width, height)):
        raise DocumentError("Некорректный размер страницы PDF.")
    scale = min(240 / 72, 4800 / width, 4800 / height, math.sqrt(9_900_000 / (width * height)))
    raster = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False)
    image = raster.tobytes("png")
    del raster
    remaining = deadline - monotonic()
    if remaining <= 0:
        raise DocumentError("Истекло время подготовки страницы для OCR. Уменьшите разрешение скана.")
    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", languages, "--psm", "3", "quiet"],
            input=image, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=remaining, check=True,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "OMP_THREAD_LIMIT": "1"},
        )
    except subprocess.TimeoutExpired as exc:
        raise DocumentError("Истекло время OCR. Разделите скан на части или уменьшите разрешение.") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise DocumentError("OCR не удалось запустить. Проверьте Tesseract и установленные языки.") from exc
    return clean(result.stdout.decode("utf-8", errors="replace"))


def pdf_sections(raw: bytes, ocr: PdfOCR | None = None):
    with pymupdf.open(stream=raw, filetype="pdf") as pdf:
        if pdf.needs_pass:
            raise DocumentError("PDF защищён паролем. Загрузите незашифрованную копию.")
        if len(pdf) > 600:
            raise DocumentError("PDF содержит более 600 страниц.")
        scanned = 0
        remaining = ocr.document_timeout if ocr else 0
        for index, page in enumerate(pdf, 1):
            text = clean(page.get_text(sort=True))
            location = f"Страница {index}"
            if text or ocr is None or not page.get_image_info():
                yield Section(text, location, index)
                continue
            scanned += 1
            if scanned > ocr.max_pages:
                raise DocumentError(f"Лимит OCR — {ocr.max_pages} страниц на документ. Разделите PDF на части.")
            if remaining <= 0:
                raise DocumentError("Исчерпан бюджет времени OCR. Разделите PDF на части.")
            started = monotonic()
            text = recognize_page(page, ocr.languages, min(ocr.page_timeout, remaining))
            remaining -= monotonic() - started
            yield Section(text, f"{location} · OCR", index, recognized=True)


def word_sections(raw: bytes):
    word: WordDocument = Word(io.BytesIO(raw))
    paragraph = table = 0
    for item in word.iter_inner_content():
        if isinstance(item, Paragraph):
            paragraph += 1
            yield Section(item.text, f"Абзац {paragraph}")
        elif isinstance(item, Table):
            table += 1
            for row, values in enumerate(item.rows, 1):
                yield Section(" | ".join(cell.text for cell in values.cells), f"Таблица {table}, строка {row}")


def csv_sections(raw: bytes):
    text = decode_text(raw)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
    except csv.Error:
        dialect = "excel"
    for row, cells in enumerate(csv.reader(io.StringIO(text, newline=""), dialect), 1):
        if len(cells) > 200:
            raise DocumentError("Таблица содержит более 200 столбцов.")
        yield Section(" | ".join(cells), f"Строка {row}")


def excel_sections(raw: bytes):
    book = load_workbook(io.BytesIO(raw), read_only=True, data_only=True, keep_links=False)
    try:
        for sheet in book.worksheets:
            if (sheet.max_column or 0) > 200 or (sheet.max_row or 0) > 20_000:
                raise DocumentError("Размер листа превышает 20 000 строк или 200 столбцов.")
            for row, cells in enumerate(sheet.values, 1):
                if row > 20_000 or len(cells) > 200:
                    raise DocumentError("Размер листа превышает 20 000 строк или 200 столбцов.")
                value = " | ".join("" if item is None else str(item) for item in cells).strip(" |")
                yield Section(value, f"{sheet.title}, строка {row}")
    finally:
        book.close()


def plain_sections(raw: bytes):
    for index, block in enumerate(re.split(r"\n\s*\n", decode_text(raw)), 1):
        yield Section(block, f"Абзац {index}")


def parse(raw: bytes, extension: str, limit: int, *, ocr: PdfOCR | None = None) -> tuple[list[Section], int | None]:
    parsers = {"pdf": partial(pdf_sections, ocr=ocr), "docx": word_sections, "csv": csv_sections, "xlsx": excel_sections}
    sections = []
    total = 0
    pages = None
    try:
        for index, item in enumerate(parsers.get(extension, plain_sections)(raw), 1):
            if index > 25_000:
                raise DocumentError("Документ содержит слишком много отдельных фрагментов.")
            content = clean(item.text)
            pages = item.page or pages
            if not content:
                continue
            total += len(content) + 2
            if total > limit:
                raise DocumentError("Извлечённый текст превышает допустимый объём.")
            sections.append(Section(content, item.location, item.page, item.recognized))
    except DocumentError:
        raise
    except (ValueError, RuntimeError, KeyError, TypeError, OSError, csv.Error, BadZipFile) as exc:
        raise DocumentError("Не удалось прочитать содержимое файла. Проверьте, что файл открывается.") from exc
    if not sections:
        msg = "Текст не найден."
        if extension == "pdf":
            msg = ("В PDF нет распознаваемого текста. Проверьте качество скана."
                   if ocr else "В PDF нет текстового слоя. Для обработки сканов включите OCR.")
        raise DocumentError(msg)
    return sections, pages
