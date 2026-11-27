
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings().db_url, pool_pre_ping=True, hide_parameters=True)
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def db_session() -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


DB = Annotated[AsyncSession, Depends(db_session)]
