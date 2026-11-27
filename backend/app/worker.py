
import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

from celery import Celery
from sqlalchemy import delete, select, update

from app import storage
from app.config import settings
from app.db import engine, session_factory
from app.embeddings import encode, split
from app.models import Chunk, Document, StorageDeletion
from app.parsing import DocumentError, PdfOCR, parse
from app.security import now

cfg = settings()
ocr = PdfOCR(cfg.ocr_languages, cfg.ocr_max_pages, cfg.ocr_page_timeout, cfg.ocr_document_timeout) if cfg.ocr_enabled else None
celery = Celery("documind", broker=cfg.redis_url)
celery.conf.update(
    task_ignore_result=True, result_backend=None, task_acks_late=True,
    worker_prefetch_multiplier=1, broker_connection_retry_on_startup=True,
    beat_schedule={"reconcile": {"task": "app.worker.reconcile", "schedule": 20.0}},
    worker_hijack_root_logger=False,
)


def run(coroutine):
    async def isolated():
        try:
            return await coroutine
        finally:
            await engine.dispose()
    return asyncio.run(isolated())


async def claim(document_id: UUID):
    async with session_factory() as db:
        row = await db.get(Document, document_id, with_for_update=True)
        if row is None or row.status not in {"queued", "uploaded"}:
            return None
        run_id = uuid4()
        row.status, row.run_id, row.attempts = "processing", run_id, row.attempts + 1
        await db.commit()
        return row.storage_key, row.extension, row.attempts, run_id


async def failure(document_id: UUID, run_id: UUID, error: str, retry: bool):
    async with session_factory() as db:
        await db.execute(update(Document).where(Document.id == document_id, Document.run_id == run_id).values(
            status="queued" if retry else "failed", error=error, run_id=None,
        ))
        await db.commit()


async def finish(document_id: UUID, run_id: UUID, sections, pages, chunks, vectors):
    async with session_factory() as db:
        row = await db.get(Document, document_id, with_for_update=True)
        if row is None or row.run_id != run_id:
            return
        await db.execute(delete(Chunk).where(Chunk.document_id == document_id))
        db.add_all(Chunk(document_id=document_id, ordinal=index, location=chunk.location, page=chunk.page,
                         content=chunk.text, embedding=vector)
                   for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)))
        row.extracted_text = "\n\n".join(section.text for section in sections)
        row.ocr_page_count = sum(section.recognized for section in sections)
        row.page_count, row.status, row.error, row.run_id = pages, "ready", None, None
        await db.commit()


@celery.task
def process(document_id: str):
    doc_id = UUID(document_id)
    claimed = run(claim(doc_id))
    if claimed is None:
        return
    key, ext, attempts, run_id = claimed
    try:
        data = storage.read(key)
        if len(data) > cfg.max_file_mb * 1024**2:
            raise DocumentError("Оригинал превышает лимит размера.")
        sections, pages = parse(data, ext, cfg.max_extracted_chars, ocr=ocr)
        chunks = split(sections, cfg.chunk_size, cfg.chunk_overlap)
        if len(chunks) > 4000:
            raise DocumentError("Документ содержит более 4 000 индексируемых фрагментов.")
        vectors = encode([chunk.text for chunk in chunks])
        run(finish(doc_id, run_id, sections, pages, chunks, vectors))
    except DocumentError as exc:
        run(failure(doc_id, run_id, str(exc), False))
    except Exception:
        retry = attempts < 3
        run(failure(doc_id, run_id, "Обработка временно недоступна. Повторите позже.", retry))
        if retry:
            process.apply_async(args=[document_id], countdown=20 * 2 ** (attempts - 1))


async def sweep():
    async with session_factory() as db:
        stale = now() - timedelta(minutes=20)
        await db.execute(update(Document).where(
            Document.status == "processing", Document.updated_at < stale, Document.attempts >= 3,
        ).values(status="failed", run_id=None, error="Обработка не завершилась. Запустите её повторно."))
        await db.execute(update(Document).where(
            Document.status == "processing", Document.updated_at < stale,
        ).values(status="queued", run_id=None))
        await db.commit()
        rows = await db.scalars(select(Document.id).where(
            Document.status.in_(("uploaded", "queued")), Document.updated_at < now() - timedelta(seconds=90)
        ).order_by(Document.updated_at).limit(30))
        ids = list(rows)
    for doc_id in ids:
        try:
            process.apply_async(args=[str(doc_id)], retry=False)
        except Exception:
            break
    async with session_factory() as db:
        items = await db.scalars(select(StorageDeletion).where(
            StorageDeletion.created_at < now()
        ).order_by(StorageDeletion.created_at).limit(30).with_for_update(skip_locked=True))
        for item in items:
            try:
                await asyncio.to_thread(storage.delete, item.storage_key)
            except Exception:
                continue
            await db.delete(item)
        await db.commit()


@celery.task
def reconcile():
    run(sweep())
