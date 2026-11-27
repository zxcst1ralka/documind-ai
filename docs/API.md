
# REST API

Open the interactive Swagger UI at `/api/v1/docs`. The OpenAPI document is
at `/api/v1/openapi.json`. Private requests require
`Authorization: Bearer <access_token>`. Cookie-based auth operations require
`X-DocuMind-Client: web` and a matching browser Origin when present. The
token is returned by registration, login and refresh. The refresh cookie is
managed by the browser.

| Area | Endpoints under `/api/v1` |
| --- | --- |
| Sessions | `POST /auth/{register,login,refresh,logout,password}`, `GET/PATCH /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}` |
| Documents | `GET/POST /documents`, `GET/PATCH/DELETE /documents/{id}`, `GET /documents/{id}/{download,text}`, `POST /documents/{id}/reprocess` |
| Citations | `GET /documents/{id}/sources/{chunk_id}` |
| Chats | `GET/POST /chats`, `GET/PATCH/DELETE /chats/{id}`, `GET/POST /chats/{id}/messages` |
| Results | `GET/POST /analyses`, `GET/DELETE /analyses/{id}`, `GET/POST /comparisons`, `GET/DELETE /comparisons/{id}` |
| Reports | `GET/POST /exports`, `GET /exports/{id}`, `GET /exports/{id}/download` |
| System | `GET /dashboard/summary`, `GET /usage`, `GET /health`, `GET /ready` |

Upload a single file per multipart request with the field `file`.
Filter documents with `q`, `format`, `status` and `sort`.
Create a chat with `{"document_ids":["<uuid>"],"title":"Study notes"}`.
Post `{"question":"What is the payment term?","consent":false}` to
its messages endpoint. For regeneration send `{"regenerate":true}`.
Set `consent:true` after user approval when the installation uses an
external provider. The stream emits `delta` chunks, then a persisted
`done` message or a safe `error`. Abort the fetch to cancel generation.
The `done` event contains source numbers, document IDs, chunk IDs and
locations. Fetch each fragment using the source endpoint above.

Reading another account's resource ID yields 404. Typical responses include
409 for a document that is still processing, 413 for upload size, 415 for
an unsupported format, 429 for limits and 503 for an unavailable service.
