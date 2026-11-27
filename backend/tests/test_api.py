
import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app import storage
from app.config import settings
from app.db import session_factory
from app.models import Chunk, Document
from app.rag import retrieve

pytestmark = pytest.mark.integration
BASE = os.getenv("DOCUMIND_TEST_API")
HEADERS = {"X-DocuMind-Client": "web"}


@pytest.fixture
async def client():
    if not BASE or settings().environment != "test":
        pytest.skip("requires Compose test stack")
    async with httpx.AsyncClient(base_url=BASE + "/api/v1", headers=HEADERS, timeout=32) as client:
        yield client


async def account(client):
    email = f"qa-{uuid4().hex}@example.com"
    response = await client.post("/auth/register", json={"name": "Проверка", "email": email,
                                                          "password": "Long-validation!2026"})
    assert response.status_code == 201, response.text
    data = response.json()
    client.headers["Authorization"] = "Bearer " + data["access_token"]
    return data["user"]


async def upload(client, name, value):
    response = await client.post("/documents", files={"file": (name, value.encode(), "text/plain")})
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def final_status(client, document_id):
    for _ in range(80):
        response = await client.get(f"/documents/{document_id}")
        row = response.json()
        if row.get("status") in {"ready", "failed"}:
            return row
        await asyncio.sleep(0.5)
    raise AssertionError("Document processing timed out")


async def test_auth_rotation_replay_and_origin(client):
    user = await account(client)
    old = client.cookies["dm_refresh"]
    response = await client.post("/auth/refresh", headers={"Origin": "https://unrelated.example"})
    assert response.status_code == 403
    response = await client.post("/auth/refresh")
    assert response.status_code == 200
    new = client.cookies["dm_refresh"]
    assert new != old
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "samesite=strict" in response.headers["set-cookie"].lower()

    async with httpx.AsyncClient(base_url=client.base_url, headers=HEADERS) as replay:
        response = await replay.post("/auth/refresh", headers={"Cookie": "dm_refresh=" + old})
        assert response.status_code == 401
    assert (await client.post("/auth/refresh")).status_code == 401
    assert (await client.get("/auth/me")).status_code == 401
    login = await client.post("/auth/login", json={"email": user["email"], "password": "Long-validation!2026"})
    assert login.status_code == 200
    client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
    response = await client.patch("/auth/me", json={"name": "Профиль"})
    assert response.json()["name"] == "Профиль"
    assert (await client.post("/auth/logout")).status_code == 204
    assert (await client.get("/auth/me")).status_code == 401


async def test_upload_and_isolated_retrieval(client):
    user = await account(client)
    assert (await client.post("/documents", files={"file": ("wrong.pdf", b"header", "application/pdf")})).status_code == 415
    assert (await client.post("/documents", files={"file": ("big.txt", b"a" * (1024**2 + 1), "text/plain")})).status_code == 413
    document_id = await upload(client, "Проверка.txt", "Срок оплаты по договору — 10 рабочих дней.")
    document = await final_status(client, document_id)
    assert document["status"] == "ready", document
    assert "10 рабочих" in (await client.get(f"/documents/{document_id}/text")).json()["text"]
    from uuid import UUID

    async with session_factory() as db:
        evidence = await retrieve(db, UUID(user["id"]), [UUID(document_id)], "Какой срок оплаты по договору?")
        assert evidence and evidence[0].location == "Абзац 1"
        assert not await retrieve(db, uuid4(), [UUID(document_id)], "Какой срок оплаты по договору?")
        key = await db.scalar(select(Document.storage_key).where(Document.id == UUID(document_id)))
    async with httpx.AsyncClient(base_url=client.base_url, headers=HEADERS) as other:
        await account(other)
        for route in ["", "/download", "/text", f"/sources/{evidence[0].chunk_id}"]:
            assert (await other.get(f"/documents/{document_id}{route}")).status_code == 404
        assert (await other.post("/chats", json={"document_ids": [document_id]})).status_code == 404
    assert (await client.delete(f"/documents/{document_id}")).status_code == 204
    assert (await client.get(f"/documents/{document_id}")).status_code == 404
    async with session_factory() as db:
        assert not await db.scalar(select(func.count()).select_from(Chunk).where(Chunk.document_id == UUID(document_id)))
    from app.worker import sweep

    await sweep()
    with pytest.raises(Exception) as missing:
        await asyncio.to_thread(storage.read, key)
    assert getattr(missing.value, "code", "") == "NoSuchKey"


async def test_chat_analysis_comparison_and_exports(client):
    await account(client)
    before = await upload(client, "Договор 1.txt", "Оплата договора — 10 рабочих дней.\n\nОбязательства сторон.")
    after = await upload(client, "Договор 2.txt", "Оплата договора — 15 рабочих дней.\n\nОбязательства сторон.")
    assert (await final_status(client, before))["status"] == "ready"
    assert (await final_status(client, after))["status"] == "ready"
    chat = await client.post("/chats", json={"document_ids": [before]})
    assert chat.status_code == 201, chat.text
    chat_path = "/chats/" + chat.json()["id"] + "/messages"
    output = await client.post(chat_path, json={"question": "Оплата договора — сколько рабочих дней?"})
    assert output.status_code == 200, output.text
    reply = [json.loads(line[6:]) for line in output.text.splitlines() if line.startswith("data: ")][-1]
    assert reply["sources"][0]["document_id"] == before, output.text
    assert (await client.get(chat_path)).json()[-1]["sources"][0]["id"] == reply["sources"][0]["id"]
    analysis = await client.post("/analyses", json={"document_id": before, "mode": "short"})
    assert analysis.status_code == 201, analysis.text
    assert analysis.json()["result"]["sources"][0]["document_id"] == before
    comparison = await client.post("/comparisons", json={"before_id": before, "after_id": after})
    assert comparison.status_code == 201, comparison.text
    assert comparison.json()["result"]["counts"]["changed"] == 1
    for fmt, expected in [("pdf", b"%PDF"), ("docx", b"PK"), ("md", b"# DocuMind AI")]:
        report = await client.post("/exports", json={"kind": "comparison", "resource_id": comparison.json()["id"], "format": fmt})
        assert report.status_code == 201, report.text
        response = await client.get("/exports/" + report.json()["id"] + "/download")
        assert response.content.startswith(expected), response.text
    assert (await client.delete(f"/documents/{before}")).status_code == 204
    assert (await client.get(chat_path)).status_code == 404
    assert (await client.get("/comparisons/" + comparison.json()["id"])).status_code == 404


async def test_rerun_and_daily_limits(client):
    await account(client)
    bad = await client.post("/documents", files={"file": ("bad.pdf", b"%PDF-invalid", "application/pdf")})
    assert bad.status_code == 201, bad.text
    doc_id = bad.json()["id"]
    assert (await final_status(client, doc_id))["status"] == "failed"
    assert (await client.post(f"/documents/{doc_id}/reprocess")).status_code == 200
    assert (await final_status(client, doc_id))["status"] == "failed"
    good = await upload(client, "Лимиты.txt", "Срок оплаты составляет десять рабочих дней.")
    assert (await final_status(client, good))["status"] == "ready"
    result = await client.post("/chats", json={"document_ids": [good]})
    path = "/chats/" + result.json()["id"] + "/messages"
    for _ in range(settings().max_ai_daily):
        response = await client.post(path, json={"question": "Срок оплаты"})
        assert response.status_code == 200, response.text
    assert (await client.post(path, json={"question": "Срок оплаты"})).status_code == 429


async def test_scanned_pdf_is_searchable_and_cited(client):
    await account(client)
    scan = Path(__file__).parent / "fixtures" / "scanned-contract.pdf"
    response = await client.post("/documents", files={"file": (scan.name, scan.read_bytes(), "application/pdf")})
    assert response.status_code == 201, response.text
    document_id = response.json()["id"]
    result = await final_status(client, document_id)
    assert (result["status"], result["page_count"], result["ocr_page_count"]) == ("ready", 1, 1), result
    text = await client.get(f"/documents/{document_id}/text")
    assert "10 рабочих дней" in text.json()["text"]
    chat = await client.post("/chats", json={"document_ids": [document_id]})
    assert chat.status_code == 201, chat.text
    reply = await client.post("/chats/" + chat.json()["id"] + "/messages", json={
        "question": "Срок оплаты договора составляет сколько рабочих дней?",
    })
    assert reply.status_code == 200, reply.text
    done = [json.loads(line[6:]) for line in reply.text.splitlines() if line.startswith("data: ")][-1]
    source = done["sources"][0]
    assert (source["document_id"], source["page"], source["location"]) == (document_id, 1, "Страница 1 · OCR")
    fragment = await client.get(f"/documents/{document_id}/sources/{source['id']}")
    assert "10 рабочих дней" in fragment.json()["text"]
    assert (await client.delete(f"/documents/{document_id}")).status_code == 204
