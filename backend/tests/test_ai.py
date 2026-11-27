
from uuid import uuid4

import httpx
import pytest

from app.ai import AIError, Disabled, HTTPProvider
from app.chats import cite
from app.config import settings
from app.rag import NO_CONTEXT, Evidence


async def test_disabled_provider():
    assert not await Disabled().available()
    with pytest.raises(AIError, match="не настроен"):
        async for _ in Disabled().stream([]):
            pytest.fail("disabled provider yielded output")


async def test_provider_does_not_follow_redirects(monkeypatch):
    monkeypatch.setattr(settings(), "ai_base_url", "http://provider.test")
    upstream = HTTPProvider(ollama=True)
    calls = []

    def respond(request):
        calls.append(request.url.host)
        return httpx.Response(status_code=302, headers={"Location": "http://other.test/"})

    monkeypatch.setattr(upstream, "client", lambda _: httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    with pytest.raises(AIError, match="Не удалось"):
        async for _ in upstream.stream([{"role": "user", "content": "Вопрос"}]):
            pytest.fail("unexpected output")
    assert calls == ["provider.test"]


def test_citations_require_response_and_in_scope_evidence():
    source = Evidence(uuid4(), uuid4(), "Договор", "Страница 1", 1,
                      "Срок оплаты составляет 10 рабочих дней после подписания акта.")
    assert cite("[1]", [source]) == NO_CONTEXT
    assert cite("Информация не найдена. [1]", [source]) == NO_CONTEXT
    assert cite("Срок оплаты составляет 20 рабочих дней [9].", [source]) == NO_CONTEXT
    assert cite("Срок оплаты составляет 10 рабочих дней.", [source]).endswith("[1]")
