
import secrets
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, StringConstraints
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.db import DB
from app.models import RefreshSession, UsedRefreshToken, User
from app.security import (
    REFRESH_DAYS,
    check_password,
    check_rate,
    credentials_error,
    current_user,
    dummy_hash,
    hash_token,
    hasher,
    new_access,
    now,
    require_same_origin,
    require_write,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
CurrentUser = Annotated[User, Depends(current_user)]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
WriteAuth = Depends(require_same_origin)
COOKIE = "dm_refresh"
COOKIE_PATH = "/api/v1/auth"


class Credentials(BaseModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class Register(Credentials):
    name: Name
    password: Password


class Profile(BaseModel):
    name: Name


class PasswordChange(BaseModel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    new_password: Password


class UserView(BaseModel):
    id: UUID
    email: str
    name: str
    read_only: bool

    model_config = {"from_attributes": True}


def cookie(response: Response, refresh: str, max_age: int):
    response.set_cookie(COOKIE, refresh, max_age=max_age, path=COOKIE_PATH,
                        httponly=True, samesite="strict", secure=settings().app_origin.startswith("https://"))
    response.headers["Cache-Control"] = "no-store"


async def issue(db: DB, response: Response, user: User):
    raw = secrets.token_urlsafe(48)
    session = RefreshSession(user_id=user.id, token_hash=hash_token(raw), expires_at=now() + timedelta(days=REFRESH_DAYS))
    db.add(session)
    await db.commit()
    cookie(response, raw, REFRESH_DAYS * 86400)
    return {"access_token": new_access(user.id, session.id), "user": UserView.model_validate(user)}


async def login_rate(request: Request, email: str = ""):
    address = request.headers.get("x-real-ip", "") if request.client else ""
    address = address or (request.client.host if request.client else "unknown")
    await check_rate(f"auth:ip:{address}", 40, 600)
    if email:
        await check_rate(f"auth:account:{hash_token(email)}", 12, 600)


@router.post("/register", status_code=201, dependencies=[WriteAuth])
async def register(payload: Register, request: Request, response: Response, db: DB):
    email = str(payload.email).casefold()
    await login_rate(request, email)
    user = User(email=email, name=payload.name, password_hash=await run_in_threadpool(hasher.hash, payload.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(409, "Этот email уже используется.") from exc
    return await issue(db, response, user)


@router.post("/login", dependencies=[WriteAuth])
async def login(payload: Credentials, request: Request, response: Response, db: DB):
    email = str(payload.email).casefold()
    await login_rate(request, email)
    user = await db.scalar(select(User).where(User.email == email).with_for_update())
    valid = await run_in_threadpool(check_password, payload.password, user.password_hash if user else dummy_hash)
    if user is None or not valid:
        raise HTTPException(401, "Неверный email или пароль.")
    return await issue(db, response, user)


@router.post("/refresh", dependencies=[WriteAuth])
async def refresh(request: Request, response: Response, db: DB):
    address = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
    await check_rate(f"refresh:{address}", 90, 60)
    raw = request.cookies.get(COOKIE)
    if not raw or len(raw) > 128:
        raise credentials_error()
    digest = hash_token(raw)
    session = await db.scalar(select(RefreshSession).where(RefreshSession.token_hash == digest).with_for_update())
    if session is None:
        replay = await db.get(UsedRefreshToken, digest)
        if replay:
            await db.execute(update(RefreshSession).where(RefreshSession.id == replay.session_id).values(revoked_at=now()))
            await db.commit()
        raise credentials_error()
    if session.revoked_at or session.expires_at <= now():
        raise credentials_error()
    user = await db.get(User, session.user_id)
    db.add(UsedRefreshToken(token_hash=digest, session_id=session.id))
    raw = secrets.token_urlsafe(48)
    session.token_hash = hash_token(raw)
    await db.commit()
    cookie(response, raw, int((session.expires_at - now()).total_seconds()))
    return {"access_token": new_access(user.id, session.id), "user": UserView.model_validate(user)}


@router.post("/logout", status_code=204, dependencies=[WriteAuth])
async def logout(request: Request, response: Response, db: DB):
    raw = request.cookies.get(COOKIE)
    if raw and len(raw) <= 128:
        await db.execute(update(RefreshSession).where(RefreshSession.token_hash == hash_token(raw)).values(revoked_at=now()))
        await db.commit()
    cookie(response, "", 0)


@router.get("/me", response_model=UserView)
async def me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserView)
async def edit_profile(payload: Profile, user: CurrentUser, db: DB):
    require_write(user)
    user.name = payload.name
    await db.commit()
    return user


@router.post("/password", dependencies=[WriteAuth])
async def change_password(payload: PasswordChange, user: CurrentUser, response: Response, db: DB):
    require_write(user)
    await check_rate(f"password:{user.id}", 8, 600)
    user = await db.get(User, user.id, with_for_update=True, populate_existing=True)
    if not await run_in_threadpool(check_password, payload.current_password, user.password_hash):
        raise HTTPException(400, "Текущий пароль введён неверно.")
    user.password_hash = await run_in_threadpool(hasher.hash, payload.new_password)
    await db.execute(update(RefreshSession).where(RefreshSession.user_id == user.id).values(revoked_at=now()))
    return await issue(db, response, user)


@router.get("/sessions")
async def sessions(request: Request, user: CurrentUser, db: DB):
    rows = await db.scalars(select(RefreshSession).where(
        RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None), RefreshSession.expires_at > now()
    ).order_by(RefreshSession.created_at.desc()))
    return [{"id": row.id, "created_at": row.created_at, "expires_at": row.expires_at,
             "current": row.id == request.state.session_id} for row in rows]


@router.delete("/sessions/{session_id}", status_code=204, dependencies=[WriteAuth])
async def revoke(session_id: UUID, request: Request, response: Response, user: CurrentUser, db: DB):
    require_write(user)
    result = await db.execute(update(RefreshSession).where(
        RefreshSession.user_id == user.id, RefreshSession.id == session_id
    ).values(revoked_at=now()))
    if not result.rowcount:
        raise HTTPException(404, "Сессия не найдена.")
    await db.commit()
    if session_id == request.state.session_id:
        cookie(response, "", 0)
