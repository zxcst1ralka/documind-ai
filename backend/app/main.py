
import asyncio
import logging
from collections import defaultdict
from time import monotonic

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import func, select, text
from starlette.concurrency import run_in_threadpool

from app import ai, auth, chats, documents, storage, workbench
from app.auth import CurrentUser
from app.config import settings
from app.db import DB
from app.models import Chat, Document, UsageEvent
from app.security import redis
from app.usage import activity, today

cfg = settings()
logger = logging.getLogger("documind")
app = FastAPI(title="DocuMind AI", version="1.1.0", docs_url=None, redoc_url=None,
              openapi_url="/api/v1/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=[cfg.app_origin], allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=[
                       "Authorization", "Content-Type", "X-DocuMind-Client",
                   ])


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PATCH", "PUT"}:
            return await self.app(scope, receive, send)
        upload = scope["method"] == "POST" and scope["path"].rstrip("/") == "/api/v1/documents"
        limit = cfg.max_file_mb * 1024**2 + 64 * 1024 if upload else 128 * 1024
        size = 0
        for key, value in scope["headers"]:
            if key == b"content-length" and value.isdigit() and int(value) > limit:
                response = JSONResponse({"detail": "Превышен допустимый размер запроса."}, status_code=413)
                return await response(scope, receive, send)

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > limit:
                raise HTTPException(413, "Превышен допустимый размер запроса.")
            return message

        return await self.app(scope, bounded_receive, send)


app.add_middleware(BodyLimit)


@app.middleware("http")
async def no_cache(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.error("Unhandled API error type=%s method=%s", type(exc).__name__, request.method)
        response = JSONResponse({"detail": "Произошла внутренняя ошибка. Повторите позже."}, status_code=500)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"detail": "Проверьте заполненные поля и допустимые значения."}, status_code=422)


@app.get("/api/v1/docs", include_in_schema=False, response_class=HTMLResponse)
async def api_docs():
    return """<!doctype html>
    <html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>DocuMind AI API</title><link rel="icon" href="/brand.svg">
    <link rel="stylesheet" href="/swagger/swagger-ui.css"></head>
    <body><div id="swagger-ui"></div><script src="/swagger/swagger-ui-bundle.js"></script>
    <script src="/swagger/init.js"></script></body></html>"""


router = APIRouter(prefix="/api/v1")
for module in (auth, documents, chats, workbench):
    router.include_router(module.router)
ai_status_lock = asyncio.Lock()
ai_status_cache = (0.0, False)


async def ai_is_up():
    global ai_status_cache
    async with ai_status_lock:
        if monotonic() >= ai_status_cache[0]:
            ai_status_cache = (monotonic() + 15, await ai.provider().available())
        return ai_status_cache[1]


@router.get("/health", tags=["System"])
async def health():
    return {"status": "ok"}


@router.get("/ready", tags=["System"])
async def ready(db: DB):
    try:
        async with asyncio.timeout(3):
            await db.execute(text("SELECT ocr_page_count FROM documents LIMIT 0"))
            if not await redis.ping() or not await run_in_threadpool(storage.client().bucket_exists, cfg.minio_bucket):
                raise RuntimeError
    except Exception as exc:
        raise HTTPException(503, "Хранилища не готовы.") from exc
    return {"status": "ready"}


@router.get("/dashboard/summary", tags=["System"])
async def summary(user: CurrentUser, db: DB):
    counts = defaultdict(int)
    rows = await db.execute(select(Document.status, func.count(), func.sum(Document.size)).where(
        Document.user_id == user.id).group_by(Document.status))
    for status, count, size in rows:
        counts[status] = count
        counts["total"] += count
        counts["bytes"] += size
    recent = await db.scalars(select(Document).where(Document.user_id == user.id).order_by(
        Document.created_at.desc()).limit(5))
    recent_chats = await db.scalars(select(Chat).where(Chat.user_id == user.id).order_by(
        Chat.created_at.desc()).limit(4))
    requests, daily = (await db.execute(select(func.count(), func.count().filter(UsageEvent.created_at >= today()))
                       .select_from(UsageEvent).where(UsageEvent.user_id == user.id))).one()
    result = {"documents": counts["total"], "ready": counts["ready"], "storage": counts["bytes"],
              "requests": requests, "daily_requests": daily, "activity": await activity(db, user.id, Document),
              "recent_documents": [documents.document_view(row) for row in recent],
              "recent_chats": [chats.chat_view(row) for row in recent_chats]}
    await db.rollback()
    return {**result, "ai": {"available": await ai_is_up(), "provider": cfg.ai_provider,
                              "model": cfg.ai_model, "external": ai.external()},
            "limits": {"max_documents": cfg.max_documents, "max_file_mb": cfg.max_file_mb,
                       "max_storage_mb": cfg.max_storage_mb, "max_jobs": cfg.max_jobs,
                       "max_ai_daily": cfg.max_ai_daily}}


@router.get("/usage", tags=["System"])
async def usage(user: CurrentUser, db: DB):
    total, input_tokens, output_tokens = (await db.execute(select(
        func.count(), func.coalesce(func.sum(UsageEvent.input_tokens), 0),
        func.coalesce(func.sum(UsageEvent.output_tokens), 0),
    ).select_from(UsageEvent).where(UsageEvent.user_id == user.id))).one()
    return {"requests": total, "input_tokens": input_tokens, "output_tokens": output_tokens,
            "daily_limit": cfg.max_ai_daily}


app.include_router(router)
