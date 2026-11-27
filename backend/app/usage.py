
from datetime import timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update

from app.config import settings
from app.db import DB, session_factory
from app.models import UsageEvent, User
from app.security import now


def today():
    return now().replace(hour=0, minute=0, second=0, microsecond=0)


async def reserve(db: DB, user_id: UUID, kind: str) -> UUID:
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    count = await db.scalar(select(func.count()).select_from(UsageEvent).where(
        UsageEvent.user_id == user_id, UsageEvent.created_at >= today()))
    if count >= settings().max_ai_daily:
        raise HTTPException(429, "Суточный лимит AI-запросов исчерпан.")
    event = UsageEvent(user_id=user_id, kind=kind)
    db.add(event)
    await db.flush()
    return event.id


async def update_usage(event_id: UUID, input_tokens: int | None, output_tokens: int | None):
    if input_tokens is None and output_tokens is None:
        return
    async with session_factory() as db:
        await db.execute(update(UsageEvent).where(UsageEvent.id == event_id).values(
            input_tokens=input_tokens, output_tokens=output_tokens))
        await db.commit()


async def activity(db: DB, user_id: UUID, document_type):
    start = today() - timedelta(days=6)

    async def counts(model):
        day = func.date_trunc("day", func.timezone("UTC", model.created_at))
        rows = await db.execute(select(day, func.count()).where(
            model.user_id == user_id, model.created_at >= start).group_by(day))
        return {time.date().isoformat(): count for time, count in rows}
    queries, docs = await counts(UsageEvent), await counts(document_type)
    days = [(start + timedelta(days=i)).date().isoformat() for i in range(7)]
    return [{"day": day, "requests": queries.get(day, 0), "documents": docs.get(day, 0)} for day in days]
