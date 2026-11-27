
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy import select

from app.config import settings
from app.db import DB
from app.models import RefreshSession, User

hasher = PasswordHasher()
dummy_hash = hasher.hash(secrets.token_urlsafe(32))
redis = Redis.from_url(settings().redis_url)
ACCESS_SECONDS = 600
REFRESH_DAYS = 14
bearer = HTTPBearer(auto_error=False)


def now() -> datetime:
    return datetime.now(UTC)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def check_password(value: str, encoded: str) -> bool:
    try:
        return hasher.verify(encoded, value)
    except (VerificationError, InvalidHashError):
        return False


def credentials_error() -> HTTPException:
    return HTTPException(401, "Войдите в аккаунт, чтобы продолжить.")


async def check_rate(key: str, maximum: int, interval: int):
    script = """
    local counter = redis.call('INCR', KEYS[1])
    if counter == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    return counter
    """
    current = await redis.eval(script, 1, f"documind:rate:{key}", interval)
    if current > maximum:
        raise HTTPException(429, "Слишком много запросов. Повторите позже.", headers={"Retry-After": str(interval)})


def require_same_origin(request: Request):
    origin = request.headers.get("origin")
    if request.headers.get("x-documind-client") != "web" or (origin and origin != settings().app_origin):
        raise HTTPException(403, "Источник запроса не подтверждён.")


def new_access(user_id: UUID, session_id: UUID) -> str:
    issued = now()
    return jwt.encode(
        {"sub": str(user_id), "sid": str(session_id), "iat": issued, "exp": issued + timedelta(seconds=ACCESS_SECONDS),
         "iss": "documind-ai", "aud": "documind-api"},
        settings().jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


async def current_user(request: Request, db: DB, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    if not credentials:
        raise credentials_error()
    try:
        claims = jwt.decode(credentials.credentials, settings().jwt_secret.get_secret_value(), algorithms=["HS256"],
                            audience="documind-api", issuer="documind-ai",
                            options={"require": ["sub", "sid", "exp", "iat"]})
        user_id, session_id = UUID(claims["sub"]), UUID(claims["sid"])
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise credentials_error() from exc
    user = await db.scalar(
        select(User).join(RefreshSession, RefreshSession.user_id == User.id).where(
            User.id == user_id, RefreshSession.id == session_id, RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now(),
        )
    )
    if user is None:
        raise credentials_error()
    request.state.session_id = session_id
    return user


def require_write(user: User):
    if user.read_only:
        raise HTTPException(403, "Демонстрационный аккаунт доступен только для чтения.")
