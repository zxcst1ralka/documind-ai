
# AI providers

The default `AI_PROVIDER=disabled` enables document indexing, the library
and deterministic comparisons. Configure a model to use chat and analysis.

## Ollama in Docker Compose

```sh
docker compose --profile ollama up -d ollama
docker compose exec ollama ollama pull qwen2.5:3b
```

Set the following values in `.env`.

```dotenv
AI_PROVIDER=ollama
AI_BASE_URL=http://ollama:11434
AI_MODEL=qwen2.5:3b
AI_EXTERNAL=false
```

Run `docker compose --profile ollama up --build -d --wait`. A host-local
Ollama installation can use `http://host.docker.internal:11434` on Docker
Desktop if the host listener is reachable by containers. Use a model
sized for available memory. Larger context and document analysis take
longer on CPU. See [Ollama API](https://docs.ollama.com/api/chat).

## OpenAI-compatible API

Set `AI_PROVIDER=openai`, `AI_BASE_URL` to the provider's API root
including its version segment if needed, `AI_MODEL` to its model ID and
`AI_API_KEY` to the server-side key. Keep `AI_EXTERNAL=true` for external
services. The dashboard checks `GET /models`; generation uses
`POST /chat/completions` with streaming. Input, selected passages and
recent chat history may leave the host once the user consents.

`AI_MAX_TOKENS`, `AI_TEMPERATURE`, `AI_TIMEOUT` and `AI_CONTEXT_CHARS`
control generation. `EMBEDDING_MODEL` and `EMBEDDING_DEVICE` affect the
local encoder. The first run loads model weights and can take longer.

## Verification

Run `node scripts/smoke-live.mjs` with a registered local stack and a
running Ollama model. The script creates a disposable account, uploads a
fictional test document, waits for E5 indexing, reads the stream and checks
the stored source. Set `DOCUMIND_URL` for another local URL. Explicitly set
`DOCUMIND_SMOKE_EXTERNAL=1` before sending that synthetic document to an
external provider. The mock provider is available only in the test
environment and CI.

Set `DOCUMIND_SMOKE_OCR=1` to use an image-only PDF. Set
`DOCUMIND_SMOKE_CONTRACT=1` to additionally verify structured contract
analysis and a persisted source from the same file.
