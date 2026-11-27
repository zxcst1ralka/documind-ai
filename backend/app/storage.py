
from functools import lru_cache
from io import BytesIO

import urllib3
from minio import Minio

from app.config import settings


@lru_cache
def client() -> Minio:
    cfg = settings()
    return Minio(
        cfg.minio_endpoint,
        access_key=cfg.minio_access_key,
        secret_key=cfg.minio_secret_key.get_secret_value(),
        secure=cfg.minio_tls,
        http_client=urllib3.PoolManager(timeout=urllib3.Timeout(connect=4, read=30), retries=False),
    )


def initialize():
    cfg = settings()
    store = client()
    if not store.bucket_exists(cfg.minio_bucket):
        store.make_bucket(cfg.minio_bucket)


def save(key: str, body: bytes, mime: str):
    client().put_object(settings().minio_bucket, key, BytesIO(body), len(body), content_type=mime)


def read(key: str) -> bytes:
    response = client().get_object(settings().minio_bucket, key)
    try:
        return response.read(settings().max_file_mb * 1024**2 + 1, cache_content=False)
    finally:
        response.close()
        response.release_conn()


def delete(key: str):
    client().remove_object(settings().minio_bucket, key)


if __name__ == "__main__":
    initialize()
