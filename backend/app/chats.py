
import asyncio
import json
import logging
import re
from contextlib import suppress
from typing import Annotated
from uuid import UUID, uuid4

import anyio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.ai import AIError, external, provider
from app.auth import CurrentUser
from app.config import settings
from app.db import DB, session_factory
from app.models import Chat, ChatDocument, Chunk, Document, Message, MessageSource, User
from app.rag import NO_CONTEXT, SYSTEM, Evidence, pack, retrieve
from app.security import redis, require_write
from app.usage import reserve, update_usage

router = APIRouter(prefix="/chats", tags=["Chat"])
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
CITATION = re.compile(r"\[(\d{1,4})\](?!\()")
logger = logging.getLogger("documind")


class NewChat(BaseModel):
    title: Title = "Новый чат"
    document_ids: list[UUID] = Field(min_length=1, max_length=20)


class RenameChat(BaseModel):
    title: Title


class Ask(BaseModel):
    question: Question | None = None
    regenerate: bool = False
    consent: bool = False


def chat_view(chat: Chat):
    return {"id": chat.id, "title": chat.title, "created_at": chat.created_at}


async def owned_chat(db: DB, user: User, chat_id: UUID) -> Chat:
    chat = await db.scalar(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    if chat is None:
        raise HTTPException(404, "Чат не найден.")
    return chat


@router.get("")
async def list_chats(user: CurrentUser, db: DB):
    return [chat_view(chat) for chat in await db.scalars(
        select(Chat).where(Chat.user_id == user.id).order_by(Chat.created_at.desc()).limit(200))]


@router.post("", status_code=201)
async def create_chat(payload: NewChat, user: CurrentUser, db: DB):
    require_write(user)
    ids = set(payload.document_ids)
    rows = await db.scalars(select(Document.id).where(
        Document.user_id == user.id, Document.status == "ready", Document.id.in_(ids)).with_for_update())
    if set(rows) != ids:
        raise HTTPException(404, "Один из выбранных документов недоступен или ещё обрабатывается.")
    chat = Chat(user_id=user.id, title=payload.title)
    db.add(chat)
    await db.flush()
    db.add_all(ChatDocument(chat_id=chat.id, document_id=document_id) for document_id in ids)
    await db.commit()
    return {**chat_view(chat), "document_ids": list(ids)}


@router.get("/{chat_id}")
async def get_chat(chat_id: UUID, user: CurrentUser, db: DB):
    chat = await owned_chat(db, user, chat_id)
    return {**chat_view(chat), "document_ids": list(await db.scalars(
        select(ChatDocument.document_id).where(ChatDocument.chat_id == chat.id)))}


@router.patch("/{chat_id}")
async def rename(chat_id: UUID, payload: RenameChat, user: CurrentUser, db: DB):
    require_write(user)
    chat = await owned_chat(db, user, chat_id)
    chat.title = payload.title
    await db.commit()
    return chat_view(chat)


@router.delete("/{chat_id}", status_code=204)
async def remove(chat_id: UUID, user: CurrentUser, db: DB):
    require_write(user)
    await db.delete(await owned_chat(db, user, chat_id))
    await db.commit()


def message_view(message: Message, sources: list[dict]):
    return {"id": message.id, "role": message.role, "content": message.content,
            "created_at": message.created_at, "sources": sources}


@router.get("/{chat_id}/messages")
async def history(chat_id: UUID, user: CurrentUser, db: DB):
    await owned_chat(db, user, chat_id)
    records = list(await db.scalars(select(Message).where(
        Message.chat_id == chat_id).order_by(Message.created_at, Message.id)))
    rows = await db.execute(select(MessageSource, Chunk, Document.name).join(
        Message, Message.id == MessageSource.message_id).join(Chunk, Chunk.id == MessageSource.chunk_id).join(
        Document, Document.id == Chunk.document_id).where(
            Message.chat_id == chat_id, Document.user_id == user.id).order_by(MessageSource.ordinal))
    refs: dict[UUID, list[dict]] = {}
    for source, chunk, name in rows:
        item = Evidence(chunk.id, chunk.document_id, name, chunk.location, chunk.page, chunk.content)
        refs.setdefault(source.message_id, []).append({**item.view(), "number": source.ordinal})
    return [message_view(message, refs.get(message.id, [])) for message in records]


def event(kind: str, data: dict) -> str:
    return f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def cite(content: str, evidence: list[Evidence]) -> str:
    content = CITATION.sub(lambda match: match[0] if 1 <= int(match[1]) <= len(evidence) else "", content).strip()
    if not CITATION.sub("", content).strip(" .,:;—\n") or re.match(
        r"^информация не найдена(?:[.\s\[]|$)", content.casefold()
    ):
        return NO_CONTEXT
    if CITATION.search(content):
        return content
    if len(evidence) == 1:
        quoted = set(re.findall(r"\w{4,}|\d+", evidence[0].text.casefold()))
        answer = set(re.findall(r"\w{4,}|\d+", content.casefold()))
        numbers = set(re.findall(r"\d+", content))
        supported_numbers = set(re.findall(r"\d+", evidence[0].text))
        abstained = re.search(r"не найден|не указа|недостаточно|not found|not provided", content.casefold())
        if not abstained and numbers <= supported_numbers and len(quoted & answer) >= 3:
            return content + " [1]"
    return NO_CONTEXT


async def unlock(key: str, token: str):
    await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end",
                     1, key, token)


async def record_reply(chat_id: UUID, user_id: UUID, content: str, evidence: list[Evidence],
                       replace_id: UUID | None):
    numbers = sorted({int(match) for match in CITATION.findall(content) if 1 <= int(match) <= len(evidence)})
    async with session_factory() as db:
        chat = await db.scalar(select(Chat.id).where(Chat.id == chat_id, Chat.user_id == user_id).with_for_update())
        if chat is None:
            raise AIError("Чат был удалён.")
        if replace_id:
            await db.execute(delete(Message).where(Message.id == replace_id, Message.chat_id == chat_id))
        reply = Message(chat_id=chat_id, role="assistant", content=content)
        db.add(reply)
        await db.flush()
        refs = []
        for number in numbers:
            item = evidence[number - 1]
            db.add(MessageSource(message_id=reply.id, chunk_id=item.chunk_id, ordinal=number))
            refs.append({**item.view(), "number": number})
        try:
            await db.commit()
        except IntegrityError as exc:
            raise AIError("Один из источников больше недоступен.") from exc
        return message_view(reply, refs)


@router.post("/{chat_id}/messages")
async def ask(chat_id: UUID, payload: Ask, request: Request, user: CurrentUser, db: DB):
    require_write(user)
    cfg = settings()
    if cfg.ai_provider == "disabled":
        raise HTTPException(503, "AI-провайдер не настроен. Укажите провайдер и модель на сервере.")
    if external() and not payload.consent:
        raise HTTPException(409, "Подтвердите передачу выбранных фрагментов внешнему AI-провайдеру.")
    key, token = f"documind:chat:{chat_id}", uuid4().hex
    chat = await owned_chat(db, user, chat_id)
    user_id = user.id
    if not await redis.set(key, token, nx=True, ex=int(cfg.ai_timeout) + 180):
        raise HTTPException(409, "В этом чате уже идёт генерация.")
    try:
        docs = list(await db.scalars(select(ChatDocument.document_id).where(ChatDocument.chat_id == chat.id)))
        recent = list(await db.scalars(select(Message).where(
            Message.chat_id == chat.id).order_by(Message.created_at.desc(), Message.id.desc()).limit(9)))
        replaced = None
        if payload.regenerate:
            if recent and recent[0].role == "assistant":
                replaced = recent.pop(0).id
            if not recent or recent[0].role != "user":
                raise HTTPException(409, "В чате пока нет вопроса для повторной генерации.")
            question = recent.pop(0).content
        else:
            if payload.question is None:
                raise HTTPException(422, "Введите вопрос.")
            question = payload.question
        previous = [{"role": row.role, "content": row.content[:700]} for row in reversed(recent[:4])]
        await db.rollback()  # Release a connection while the local embedding model runs.
        try:
            evidence = await retrieve(db, user_id, docs, question)
        except Exception as exc:
            raise HTTPException(503, "Семантический поиск временно недоступен.") from exc
        event_id = await reserve(db, user_id, "chat")
        if await db.scalar(select(Chat.id).where(Chat.id == chat_id, Chat.user_id == user_id).with_for_update()) is None:
            raise HTTPException(404, "Чат был удалён.")
        if not payload.regenerate:
            db.add(Message(chat_id=chat_id, role="user", content=question))
        await db.commit()
    except BaseException:
        await unlock(key, token)
        raise

    async def stream():
        iterator = task = None
        input_tokens = output_tokens = None
        try:
            if not evidence:
                yield event("delta", {"text": NO_CONTEXT})
                content = NO_CONTEXT
            else:
                prompt = [{"role": "system", "content": SYSTEM}, *previous,
                          {"role": "user", "content": f"Фрагменты документа:\n{pack(evidence)}\n\nВопрос: {question}"}]
                parts = []
                iterator = provider().stream(prompt)
                async with asyncio.timeout(cfg.ai_timeout):
                    while True:
                        task = asyncio.create_task(anext(iterator))
                        while not (await asyncio.wait({task}, timeout=8))[0]:
                            if await request.is_disconnected():
                                return
                            yield ": heartbeat\n\n"
                        try:
                            part = task.result()
                        except StopAsyncIteration:
                            break
                        if await request.is_disconnected():
                            return
                        if part.text:
                            parts.append(part.text)
                            yield event("delta", {"text": part.text})
                        input_tokens = part.input_tokens if part.input_tokens is not None else input_tokens
                        output_tokens = part.output_tokens if part.output_tokens is not None else output_tokens
                if not any(parts):
                    raise AIError("AI-провайдер вернул пустой ответ.")
                content = cite("".join(parts), evidence)
            if not await request.is_disconnected():
                reply = await record_reply(chat_id, user_id, content, evidence, replaced)
                await update_usage(event_id, input_tokens, output_tokens)
                yield event("done", reply)
        except (AIError, TimeoutError) as exc:
            yield event("error", {"message": str(exc) or "Время ожидания ответа AI истекло."})
        except Exception as exc:
            logger.error("Chat stream failed type=%s", type(exc).__name__)
            yield event("error", {"message": "Произошла ошибка при сохранении ответа."})
        finally:
            with anyio.CancelScope(shield=True):
                if task is not None and not task.done():
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
                if iterator is not None:
                    await iterator.aclose()
                await unlock(key, token)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
