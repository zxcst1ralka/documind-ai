
FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/pip pip install pip==26.3 setuptools==84.2.1 && pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
RUN groupadd -g 10001 documind && useradd -u 10001 -g 10001 documind && mkdir /model-cache && chown documind:documind /model-cache
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HF_HOME=/model-cache OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false HF_HUB_DISABLE_XET=1
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
COPY . .
USER documind
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM runtime AS test
USER root
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements-dev.txt
USER documind
