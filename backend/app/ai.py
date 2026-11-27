
import asyncio
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import settings


class AIError(RuntimeError):
    pass


@dataclass(frozen=True)
class Part:
    text: str = ""
    input_tokens: int | None = None
    output_tokens: int | None = None


class AIProvider(Protocol):
    async def available(self) -> bool: ...
    def stream(self, messages: list[dict[str, str]], *, json_response: bool = False) -> AsyncIterator[Part]: ...


class Disabled:
    async def available(self) -> bool:
        return False

    async def stream(self, messages, *, json_response=False):
        raise AIError("AI-провайдер не настроен. Укажите провайдер и модель в конфигурации сервера.")
        yield


class TestProvider:
    async def available(self) -> bool:
        return True

    async def stream(self, messages, *, json_response=False):
        context = messages[-1]["content"]
        match = re.search(r'\[1\].*?\n([^\n]+)', context, flags=re.S)
        evidence = match.group(1)[:240] if match else "Проверочный результат"
        if "ФОРМАТ_JSON" in messages[0]["content"]:
            yield Part(json.dumps({"summary": evidence, "findings": [{"title": "Проверка",
                            "detail": evidence, "sources": [1]}], "contract": None}, ensure_ascii=False))
        else:
            yield Part("Тестовый ответ. ")
            yield Part(f"{evidence} [1]", 32, 14)


class HTTPProvider:
    def __init__(self, ollama: bool):
        self.cfg = settings()
        self.ollama = ollama
        self.base = self.cfg.ai_base_url.rstrip("/")
        token = self.cfg.ai_api_key.get_secret_value()
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}

    def client(self, timeout: float):
        return httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(timeout, 6.0)),
                                 trust_env=False, follow_redirects=False, headers=self.headers)

    async def available(self) -> bool:
        try:
            async with self.client(3) as client:
                result = await client.get(self.base + ("/api/tags" if self.ollama else "/models"))
                result.raise_for_status()
                body = result.json()
                models = body["models"] if self.ollama else body["data"]
                key = "name" if self.ollama else "id"
                name = self.cfg.ai_model
                return any(model[key] == name or (self.ollama and model[key] == f"{name}:latest") for model in models)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return False

    async def stream(self, messages, *, json_response=False):
        cfg = self.cfg
        endpoint = "/api/chat" if self.ollama else "/chat/completions"
        payload = {"model": cfg.ai_model, "messages": messages, "stream": True}
        if self.ollama:
            payload.update(options={"num_predict": cfg.ai_max_tokens, "temperature": cfg.ai_temperature,
                                    "num_ctx": max(8192, cfg.ai_context_chars // 2 + cfg.ai_max_tokens + 2048)},
                           think=False)
            if json_response:
                payload["format"] = "json"
        else:
            payload.update(max_tokens=cfg.ai_max_tokens, temperature=cfg.ai_temperature,
                           stream_options={"include_usage": True})
            if json_response:
                payload["response_format"] = {"type": "json_object"}
        for attempt in range(2):
            emitted = finished = False
            try:
                async with self.client(cfg.ai_timeout) as client:
                    async with client.stream("POST", self.base + endpoint, json=payload) as response:
                        if attempt == 0 and response.status_code == 400 and "stream_options" in payload:
                            payload.pop("stream_options")
                            payload.pop("response_format", None)
                            continue
                        if attempt == 0 and response.status_code in {429, 502, 503, 504}:
                            await asyncio.sleep(0.6)
                            continue
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line or (not self.ollama and not line.startswith("data:")):
                                continue
                            message = line if self.ollama else line[5:].strip()
                            if message == "[DONE]":
                                finished = True
                                break
                            data = json.loads(message)
                            if data.get("error"):
                                raise AIError("AI-провайдер вернул ошибку генерации.")
                            emitted = True
                            if self.ollama:
                                yield Part(data.get("message", {}).get("content", ""),
                                           data.get("prompt_eval_count"), data.get("eval_count"))
                                finished = bool(data.get("done"))
                                if finished:
                                    break
                            else:
                                usage = data.get("usage") or {}
                                choices = data.get("choices") or []
                                delta = choices[0].get("delta", {}) if choices else {}
                                if choices and choices[0].get("finish_reason"):
                                    finished = True
                                yield Part(delta.get("content") or "", usage.get("prompt_tokens"),
                                           usage.get("completion_tokens"))
                if not finished:
                    raise AIError("Поток ответа AI завершился раньше времени.")
                return
            except (httpx.TransportError, httpx.HTTPStatusError, ValueError, TypeError) as exc:
                if attempt == 0 and not emitted and isinstance(exc, httpx.TransportError):
                    await asyncio.sleep(0.6)
                    continue
                raise AIError("Не удалось получить ответ AI. Проверьте модель и доступность провайдера.") from exc
        raise AIError("AI-провайдер временно недоступен.")


def provider() -> AIProvider:
    choice = settings().ai_provider
    if choice == "disabled":
        return Disabled()
    if choice == "mock":
        return TestProvider()
    return HTTPProvider(ollama=choice == "ollama")


def external() -> bool:
    return settings().ai_provider in {"openai", "ollama"} and settings().ai_external


async def complete(messages: list[dict[str, str]], *, json_response: bool = False) -> Part:
    output = []
    used_input = used_output = None
    try:
        async with asyncio.timeout(settings().ai_timeout):
            async for part in provider().stream(messages, json_response=json_response):
                output.append(part.text)
                used_input = part.input_tokens if part.input_tokens is not None else used_input
                used_output = part.output_tokens if part.output_tokens is not None else used_output
    except TimeoutError as exc:
        raise AIError("Время ожидания ответа AI истекло.") from exc
    return Part("".join(output), used_input, used_output)
