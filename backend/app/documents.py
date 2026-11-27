
import hashlib
import re
from datetime import timedelta
from pathlib import PurePosixPath
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update
from starlette.concurrency import run_in_threadpool

from app import storage
from app.auth import CurrentUser
from app.config import settings
from app.db import DB
from app.models import Chat, ChatDocument, Chunk, Document, StorageDeletion, User
from app.parsing import DocumentError, validate
from app.security import check_rate, now, require_write

router = APIRouter(prefix="/documents", tags=["Documents"])
ACTIVE = ("uploaded", "queued", "processing")


class DocumentUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    category: str | None = Field(None, max_length=80)
    tags: list[str] | None = Field(None, max_length=15)

    @field_validator("name", "category")
    @classmethod
    def clean_field(cls, value):
        return value.strip() if value else None

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value):
        if value is None:
            return value
        tags = list(dict.fromkeys(tag.strip() for tag in value if tag.strip()))
        if any(len(tag) > 40 for tag in tags):
            raise ValueError("Название тега должно содержать до 40 символов.")
        return tags


def document_view(row: Document):
    fields = ("id", "name", "original_name", "extension", "mime", "size", "sha256", "status", "error",
              "page_count", "ocr_page_count", "category", "tags", "created_at", "updated_at")
    return {field: getattr(row, field) for field in fields}


async def owned_document(db: DB, user: User, document_id: UUID, *, lock: bool = False) -> Document:
    query = select(Document).where(Document.id == document_id, Document.user_id == user.id)
    row = await db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(404, "Документ не найден.")
    return row


async def check_capacity(db: DB, user: User, additional_bytes: int = 0, *, adding: bool = False):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    count, size, active = (await db.execute(select(
        func.count(), func.coalesce(func.sum(Document.size), 0),
        func.count().filter(Document.status.in_(ACTIVE)),
    ).select_from(Document).where(Document.user_id == user.id))).one()
    cfg = settings()
    if (adding and count >= cfg.max_documents) or size + additional_bytes > cfg.max_storage_mb * 1024**2:
        raise HTTPException(409, "Достигнут лимит количества документов или места в библиотеке.")
    if active >= cfg.max_jobs:
        raise HTTPException(409, "Слишком много документов обрабатывается одновременно. Повторите позже.")


async def enqueue(db: DB, row: Document):
    from app.worker import process

    await db.execute(update(Document).where(Document.id == row.id, Document.status == "uploaded").values(status="queued"))
    await db.commit()
    try:
        await run_in_threadpool(process.apply_async, args=[str(row.id)], retry=False)
    except Exception:
        # Periodic reconciliation recovers the committed queue entry.
        pass


@router.get("")
async def documents(user: CurrentUser, db: DB, q: str = Query("", max_length=255), format: str = "",
                    status: str = "", sort: str = "new"):
    stmt = select(Document).where(Document.user_id == user.id)
    if q:
        stmt = stmt.where(Document.name.icontains(q.strip(), autoescape=True))
    if format:
        stmt = stmt.where(Document.extension == format)
    if status:
        stmt = stmt.where(Document.status == status)
    order = {"name": func.lower(Document.name), "old": Document.created_at, "size": Document.size.desc()}
    return [document_view(row) for row in await db.scalars(stmt.order_by(order.get(sort, Document.created_at.desc()))) ]


@router.post("", status_code=201)
async def upload(file: UploadFile, user: CurrentUser, db: DB):
    require_write(user)
    await check_rate(f"upload:{user.id}", 60, 600)
    file_name = PurePosixPath((file.filename or "").replace("\\", "/")).name
    file_name = re.sub(r"[\x00-\x1f\x7f]", "", file_name).strip()[:255]
    extension = file_name.rpartition(".")[2].lower()
    maximum = settings().max_file_mb * 1024**2
    try:
        if file.size is not None and file.size > maximum:
            raise HTTPException(413, "Файл превышает допустимый размер.")
        body = await file.read(maximum + 1)
    finally:
        await file.close()
    if len(body) > maximum:
        raise HTTPException(413, "Файл превышает допустимый размер.")
    try:
        mime = await run_in_threadpool(validate, body, extension, file.content_type)
    except DocumentError as exc:
        raise HTTPException(415, str(exc)) from exc
    key = f"{user.id}/{uuid4()}"
    intent = StorageDeletion(storage_key=key, created_at=now() + timedelta(minutes=15))
    db.add(intent)
    user_id = user.id
    await db.commit()
    await check_capacity(db, user, len(body), adding=True)
    try:
        await run_in_threadpool(storage.save, key, body, mime)
    except Exception as exc:
        raise HTTPException(503, "Хранилище временно недоступно.") from exc
    row = Document(user_id=user_id, name=file_name, original_name=file_name, extension=extension, mime=mime,
                   size=len(body), storage_key=key, sha256=hashlib.sha256(body).hexdigest(), status="uploaded")
    db.add(row)
    await db.delete(intent)
    await db.commit()
    await enqueue(db, row)
    await db.refresh(row)
    return document_view(row)


@router.get("/{document_id}")
async def get_document(document_id: UUID, user: CurrentUser, db: DB):
    return document_view(await owned_document(db, user, document_id))


@router.patch("/{document_id}")
async def update_document(document_id: UUID, payload: DocumentUpdate, user: CurrentUser, db: DB):
    require_write(user)
    row = await owned_document(db, user, document_id, lock=True)
    if payload.name:
        row.name = payload.name
    if "category" in payload.model_fields_set:
        row.category = payload.category
    if payload.tags is not None:
        row.tags = payload.tags
    await db.commit()
    await db.refresh(row)
    return document_view(row)


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: UUID, user: CurrentUser, db: DB):
    require_write(user)
    row = await owned_document(db, user, document_id, lock=True)
    related_chats = select(ChatDocument.chat_id).where(ChatDocument.document_id == row.id)
    await db.execute(delete(Chat).where(Chat.user_id == user.id, Chat.id.in_(related_chats)))
    db.add(StorageDeletion(storage_key=row.storage_key))
    await db.delete(row)
    await db.commit()


@router.get("/{document_id}/download")
async def download(document_id: UUID, user: CurrentUser, db: DB):
    row = await owned_document(db, user, document_id)
    try:
        data = await run_in_threadpool(storage.read, row.storage_key)
    except Exception as exc:
        raise HTTPException(503, "Не удалось получить оригинал из хранилища.") from exc
    return Response(data, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.original_name, safe='')}",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/{document_id}/text")
async def document_text(document_id: UUID, user: CurrentUser, db: DB):
    row = await owned_document(db, user, document_id)
    if row.status != "ready":
        raise HTTPException(409, "Текст ещё недоступен.")
    return {"text": row.extracted_text}


@router.get("/{document_id}/sources/{chunk_id}")
async def fragment(document_id: UUID, chunk_id: UUID, user: CurrentUser, db: DB):
    row = await owned_document(db, user, document_id)
    source = await db.scalar(select(Chunk).where(Chunk.document_id == row.id, Chunk.id == chunk_id))
    if source is None:
        raise HTTPException(404, "Фрагмент не найден.")
    return {"id": source.id, "document_id": row.id, "name": row.name, "text": source.content,
            "page": source.page, "location": source.location}


@router.post("/{document_id}/reprocess")
async def reprocess(document_id: UUID, user: CurrentUser, db: DB):
    require_write(user)
    await check_capacity(db, user)
    row = await owned_document(db, user, document_id, lock=True)
    if row.status != "failed":
        raise HTTPException(409, "Повторная обработка доступна для документов с ошибкой.")
    row.status, row.error, row.attempts = "uploaded", None, 0
    await db.commit()
    await enqueue(db, row)
    await db.refresh(row)
    return document_view(row)
