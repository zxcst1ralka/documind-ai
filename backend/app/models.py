
from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Record:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Record, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(Text)
    read_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class RefreshSession(Record, Base):
    __tablename__ = "refresh_sessions"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UsedRefreshToken(Base):
    __tablename__ = "used_refresh_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("refresh_sessions.id", ondelete="CASCADE"), index=True)


class Document(Record, Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_owner_created_at", "user_id", "created_at"),
        Index("ix_documents_pending", "status", "updated_at"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    original_name: Mapped[str] = mapped_column(String(255))
    extension: Mapped[str] = mapped_column(String(8))
    mime: Mapped[str] = mapped_column(String(150))
    size: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(180), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(Text)
    page_count: Mapped[int | None] = mapped_column(Integer)
    ocr_page_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    extracted_text: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(80))
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_id: Mapped[UUID | None]
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Chunk(Record, Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "ordinal"),
        Index("ix_document_chunks_embedding", "embedding", postgresql_using="hnsw",
              postgresql_ops={"embedding": "vector_cosine_ops"}),
    )
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    ordinal: Mapped[int]
    location: Mapped[str] = mapped_column(String(180))
    page: Mapped[int | None]
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(384))


class StorageDeletion(Record, Base):
    __tablename__ = "storage_deletions"
    storage_key: Mapped[str] = mapped_column(String(180), unique=True)


class Chat(Record, Base):
    __tablename__ = "chats"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(100))


class ChatDocument(Base):
    __tablename__ = "chat_documents"
    chat_id: Mapped[UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True)
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Message(Record, Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_chat_created", "chat_id", "created_at"),)
    chat_id: Mapped[UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(15))
    content: Mapped[str] = mapped_column(Text)


class MessageSource(Base):
    __tablename__ = "message_sources"
    message_id: Mapped[UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    chunk_id: Mapped[UUID] = mapped_column(ForeignKey("document_chunks.id", ondelete="CASCADE"),
                                           primary_key=True, index=True)
    ordinal: Mapped[int]


class UsageEvent(Record, Base):
    __tablename__ = "usage_events"
    __table_args__ = (Index("ix_usage_events_owner_created", "user_id", "created_at"),)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]


class Analysis(Record, Base):
    __tablename__ = "analyses"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    document_name: Mapped[str] = mapped_column(String(255))
    mode: Mapped[str] = mapped_column(String(35))
    result: Mapped[dict] = mapped_column(JSONB)


class Comparison(Record, Base):
    __tablename__ = "comparisons"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    before_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    after_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    before_name: Mapped[str] = mapped_column(String(255))
    after_name: Mapped[str] = mapped_column(String(255))
    result: Mapped[dict] = mapped_column(JSONB)


class Export(Record, Base):
    __tablename__ = "exports"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    analysis_id: Mapped[UUID | None] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    comparison_id: Mapped[UUID | None] = mapped_column(ForeignKey("comparisons.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(8))
    title: Mapped[str] = mapped_column(String(255))
