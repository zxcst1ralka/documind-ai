
# Security

- Access tokens use a short lifetime, a fixed algorithm, issuer and audience,
  and a live session check. Refresh secrets rotate in an HttpOnly SameSite
  cookie. Only refresh digests are stored. Replay revokes the session family.
  Passwords use Argon2id. A password change revokes existing sessions.
- The API checks resource ownership before reads and writes. Private MinIO
  objects and generated reports are served through authenticated routes.
  Document deletion clears the index and related chat and report records.
  A durable outbox retries cleanup of original objects.
- Nginx and the API cap request sizes. The parser checks MIME, extension
  and signatures, limits Office archive expansion, rejects unsafe internal
  paths and imposes text, page, row and chunk budgets. It runs in a
  non-root worker. Only locally cached spreadsheet values are read.
- OCR runs locally in the worker using a fixed Tesseract command and
  page, pixel and time budgets. The raster is passed through stdin.
- Same-origin browser calls protect the refresh cookie with a custom header
  and Origin verification. CORS uses `APP_ORIGIN`. Markdown is rendered without
  embedded HTML, remote images or outbound model-generated links.
- The AI provider URL comes from server configuration. Clients do not
  control the destination. Redirects are disabled. External data exchange
  requires explicit consent. The LLM receives untrusted excerpts and has no
  tools. Prompt instructions and grounding reduce injection risk, which
  remains a model limitation.
- Rate and usage limits are enforced server-side. Upload limits are checked
  with a per-account database lock. Secret material and file text stay out
  of application logs. Nginx access logs are disabled by default.
- The runtime is designed for a portfolio or a small private installation.
  Before serving untrusted Internet traffic, review parser isolation,
  host backup and restore, secret delivery, TLS, role separation for the
  data stores, image scanning and operational alerts.

See [Deployment](DEPLOYMENT.md) for environment and exposure.
