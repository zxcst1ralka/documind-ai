
import hashlib
import math
import re
from functools import lru_cache
from threading import Lock

from app.config import settings
from app.parsing import Section

model_lock = Lock()


@lru_cache
def model():
    from sentence_transformers import SentenceTransformer

    cfg = settings()
    encoder = SentenceTransformer(
        cfg.embedding_model, device=cfg.embedding_device, trust_remote_code=False,
        model_kwargs={"use_safetensors": True},
    )
    if encoder.get_embedding_dimension() != 384:
        raise ValueError("Embedding model must output 384 dimensions")
    return encoder


def token_offsets(text: str) -> list[tuple[int, int]]:
    if settings().embedding_test_mode:
        return [match.span() for match in re.finditer(r"\S+", text)]
    with model_lock:
        return model().tokenizer(text, add_special_tokens=False, return_offsets_mapping=True,
                                 truncation=False, verbose=False)["offset_mapping"]


def split(sections: list[Section], size: int, overlap: int) -> list[Section]:
    chunks = []
    for section in sections:
        offsets = token_offsets(section.text)
        if len(offsets) <= size:
            chunks.append(section)
            continue
        for start in range(0, len(offsets), size - overlap):
            end = min(start + size, len(offsets))
            content = section.text[offsets[start][0]:offsets[end - 1][1]]
            chunks.append(Section(content, section.location, section.page, section.recognized))
            if end == len(offsets):
                break
    return chunks


def unit(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return [value / norm for value in values]


def test_vector(text: str) -> list[float]:
    values = [0.0] * 384
    for word in re.findall(r"\w+", text.casefold()):
        index = int.from_bytes(hashlib.blake2b(word.encode(), digest_size=4).digest(), "big") % 384
        values[index] += 1.0
    if not any(values):
        values[0] = 1.0
    return unit(values)


def encode(texts: list[str], query: bool = False) -> list[list[float]]:
    if settings().embedding_test_mode:
        return [test_vector(text) for text in texts]
    with model_lock:
        encoder = model()
        prefix = "query: " if query else "passage: "
        limit = min(encoder.max_seq_length - 12, 480)
        pieces = []
        boundaries = [0]
        tokenized = encoder.tokenizer(texts, add_special_tokens=False, return_offsets_mapping=True,
                                     truncation=False, verbose=False)["offset_mapping"]
        for text, offsets in zip(texts, tokenized, strict=True):
            if not offsets:
                pieces.append(prefix + text)
            for start in range(0, len(offsets), limit):
                stop = min(start + limit, len(offsets))
                pieces.append(prefix + text[offsets[start][0]:offsets[stop - 1][1]])
            boundaries.append(len(pieces))
        vectors = encoder.encode(pieces, batch_size=16, normalize_embeddings=True,
                                 show_progress_bar=False, convert_to_numpy=True)
        return [unit(vectors[start:stop].mean(axis=0).tolist())
                for start, stop in zip(boundaries[:-1], boundaries[1:], strict=True)]
