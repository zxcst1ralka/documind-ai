
from functools import lru_cache
from typing import Literal
from urllib.parse import quote, urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "production", "test"] = "development"
    app_origin: str = "http://localhost:8080"
    jwt_secret: SecretStr
    database_host: str = "postgres"
    database_name: str = "documind"
    database_user: str = "documind"
    database_password: SecretStr
    redis_url: str = "redis://redis:6379/0"
    minio_endpoint: str = "minio:9000"
    minio_access_key: str
    minio_secret_key: SecretStr
    minio_bucket: str = "documents"
    minio_tls: bool = False
    max_file_mb: int = Field(25, ge=1, le=100)
    max_storage_mb: int = Field(250, ge=1)
    max_documents: int = Field(20, ge=1)
    max_jobs: int = Field(3, ge=1)
    max_ai_daily: int = Field(50, ge=1)
    max_extracted_chars: int = Field(750_000, ge=1000)
    ocr_enabled: bool = True
    ocr_languages: Literal["rus+eng", "eng+rus", "rus", "eng"] = "rus+eng"
    ocr_max_pages: int = Field(30, ge=1, le=100)
    ocr_page_timeout: float = Field(15, gt=0, le=60)
    ocr_document_timeout: float = Field(120, gt=0, le=300)
    ai_provider: Literal["disabled", "openai", "ollama", "mock"] = "disabled"
    ai_base_url: str = ""
    ai_api_key: SecretStr = SecretStr("")
    ai_model: str = ""
    ai_external: bool = True
    ai_max_tokens: int = Field(900, ge=128, le=8192)
    ai_temperature: float = Field(0.15, ge=0, le=2)
    ai_timeout: float = Field(120, gt=0, le=600)
    ai_context_chars: int = Field(28_000, ge=4000, le=200_000)
    embedding_model: str = "intfloat/multilingual-e5-small"
    embedding_device: str = "cpu"
    embedding_test_mode: bool = False
    chunk_size: int = Field(800, ge=64, le=2000)
    chunk_overlap: int = Field(150, ge=0)
    top_k: int = Field(6, ge=1, le=12)
    relevance_threshold: float = Field(0.70, ge=-1, le=1)
    pdf_font_dir: str = "/usr/share/fonts/truetype/dejavu"

    @property
    def db_url(self) -> str:
        password = quote(self.database_password.get_secret_value(), safe="")
        return f"postgresql+asyncpg://{self.database_user}:{password}@{self.database_host}/{self.database_name}"

    @model_validator(mode="after")
    def validate_settings(self):
        if len(self.jwt_secret.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 characters")
        origin = urlsplit(self.app_origin)
        if origin.scheme not in {"http", "https"} or not origin.hostname or (
            origin.path or origin.query or origin.fragment or origin.username
        ):
            raise ValueError("APP_ORIGIN must be an exact HTTP(S) origin without a trailing slash")
        if self.environment == "production" and origin.scheme != "https":
            raise ValueError("Production requires an HTTPS APP_ORIGIN")
        if (self.embedding_test_mode or self.ai_provider == "mock") and self.environment != "test":
            raise ValueError("Test doubles require ENVIRONMENT=test")
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        if self.ai_provider in {"openai", "ollama"}:
            parsed = urlsplit(self.ai_base_url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or (
                parsed.username or parsed.query or parsed.fragment
            ) or not self.ai_model:
                raise ValueError("Configure a trusted AI_BASE_URL and AI_MODEL")
            if self.environment == "production" and self.ai_external and parsed.scheme != "https":
                raise ValueError("External AI providers require HTTPS in production")
        return self


@lru_cache
def settings() -> Settings:
    return Settings()
