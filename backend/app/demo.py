
import argparse
import asyncio
import hashlib
from datetime import timedelta
from getpass import getpass
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from pydantic import EmailStr, TypeAdapter
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy import select

from app import storage
from app.db import engine, session_factory
from app.models import (
    Chat,
    ChatDocument,
    Chunk,
    Comparison,
    Document,
    Message,
    MessageSource,
    StorageDeletion,
    User,
)
from app.parsing import FORMATS, parse
from app.reports import font
from app.security import hasher, now
from app.workbench import diff
from app.worker import process

SAMPLES = Path(__file__).resolve().parents[1] / "demo"
DEMO = "Демонстрационные данные. Все организации и условия вымышлены."


def create_pdf(text: str) -> bytes:
    stream = BytesIO()
    page = Canvas(stream)
    page.setTitle("Учебный договор")
    page.setFont(font(), 11)
    y = 785
    for line in text.splitlines():
        while len(line) > 80:
            split = line.rfind(" ", 0, 80)
            split = split if split > 0 else 80
            page.drawString(55, y, line[:split])
            y -= 18
            line = line[split:].lstrip()
        page.drawString(55, y, line)
        y -= 18
    page.save()
    return stream.getvalue()


def sample_files():
    base = (SAMPLES / "contract-v1.txt").read_bytes()
    amended = (SAMPLES / "contract-v2.txt").read_bytes()
    return {
        "Демо · Договор оказания услуг.pdf": create_pdf(base.decode()),
        "Демо · Договор, версия 1.txt": base,
        "Демо · Договор, версия 2.txt": amended,
        "Демо · Коммерческое предложение.md": (SAMPLES / "proposal.md").read_bytes(),
        "Демо · План расходов.csv": (SAMPLES / "budget.csv").read_bytes(),
        "Демо · Инструкция для команды.md": (SAMPLES / "handbook.md").read_bytes(),
    }


async def seed(email: str, password: str):
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, name="Демо-библиотека", password_hash=hasher.hash(password), read_only=True)
            db.add(user)
            await db.commit()
        elif not user.read_only or not hasher.verify(user.password_hash, password):
            raise SystemExit("Аккаунт уже существует. Используйте адрес и пароль созданного демо-аккаунта.")
        existing = {row.name: row for row in await db.scalars(select(Document).where(Document.user_id == user.id))}
        for name, raw in sample_files().items():
            if name in existing:
                continue
            key = f"{user.id}/{uuid4()}"
            intent = StorageDeletion(storage_key=key, created_at=now() + timedelta(minutes=15))
            db.add(intent)
            await db.commit()
            extension = name.rsplit(".", 1)[-1]
            mime = FORMATS[extension]
            await asyncio.to_thread(storage.save, key, raw, mime)
            row = Document(user_id=user.id, name=name, original_name=name, extension=extension, mime=mime,
                           size=len(raw), storage_key=key, sha256=hashlib.sha256(raw).hexdigest(), status="queued",
                           category="Демонстрация", tags=["Вымышленные данные"])
            db.add(row)
            await db.delete(intent)
            await db.commit()
            existing[name] = row
            await asyncio.to_thread(process.apply_async, args=[str(row.id)])
        before = existing["Демо · Договор, версия 1.txt"]
        after = existing["Демо · Договор, версия 2.txt"]
        if not await db.scalar(select(Comparison.id).where(Comparison.user_id == user.id)):
            originals = sample_files()
            old = "\n\n".join(part.text for part in parse(originals[before.name], "txt", 10000)[0])
            new = "\n\n".join(part.text for part in parse(originals[after.name], "txt", 10000)[0])
            db.add(Comparison(user_id=user.id, before_id=before.id, after_id=after.id,
                              before_name=before.name, after_name=after.name, result=diff(old, new)))
            await db.commit()
        return user.id, before.id


async def add_sample_chat(user_id, document_id):
    for _ in range(90):
        async with session_factory() as db:
            if await db.scalar(select(Chat.id).where(Chat.user_id == user_id)):
                return
            source = await db.scalar(select(Chunk).where(
                Chunk.document_id == document_id, Chunk.content.contains("10 рабочих дней")).limit(1))
            if source is not None:
                chat = Chat(user_id=user_id, title="Демо · Срок оплаты")
                db.add(chat)
                await db.flush()
                db.add_all([ChatDocument(chat_id=chat.id, document_id=document_id),
                            Message(chat_id=chat.id, role="user", content="Какой срок оплаты по договору?")])
                await db.commit()
                reply = Message(chat_id=chat.id, role="assistant",
                                content="Демонстрационный ответ. Оплата производится в течение 10 рабочих дней "
                                        "после подписания акта [1].")
                db.add(reply)
                await db.flush()
                db.add(MessageSource(message_id=reply.id, chunk_id=source.id, ordinal=1))
                await db.commit()
                return
        await asyncio.sleep(2)
    print("Индексация ещё не завершилась. Повторите seed-команду, чтобы добавить демонстрационный чат.")


async def run(email: str, password: str):
    try:
        await add_sample_chat(*await seed(email, password))
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Загрузить вымышленные документы и демо-диалог.")
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    email = TypeAdapter(EmailStr).validate_python(args.email).casefold()
    password = getpass("Пароль демо-аккаунта: ")
    if not 12 <= len(password) <= 128:
        parser.error("Пароль должен содержать от 12 до 128 символов.")
    asyncio.run(run(email, password))
    print("Демо-библиотека подготовлена.")


if __name__ == "__main__":
    main()
