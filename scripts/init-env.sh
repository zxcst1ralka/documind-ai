
#!/usr/bin/env sh
set -eu
umask 077
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
from secrets import token_hex

keys = {"JWT_SECRET", "DATABASE_PASSWORD", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"}
with Path(".env").open("x", encoding="utf-8") as output:
    output.writelines(f"{line.split('=')[0]}={token_hex(32)}\n" if line.split('=')[0] in keys else line
                      for line in Path(".env.example").read_text(encoding="utf-8").splitlines(keepends=True))
PY
