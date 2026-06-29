"""
Lazy-loaded sentence-transformers embedding service.
Model (all-MiniLM-L6-v2, ~80 MB) downloads on first call.

If torch / sentence-transformers is not installed the functions raise
RuntimeError with a clear message — callers should surface this as HTTP 503.
"""

from __future__ import annotations
from functools import lru_cache


@lru_cache(maxsize=1)
def _model():
    try:
        from sentence_transformers import SentenceTransformer
        return SentenceTransformer("all-MiniLM-L6-v2")
    except Exception as exc:
        raise RuntimeError(
            f"Embedding model unavailable: {exc}. "
            "Run: pip install torch sentence-transformers  then restart the backend."
        ) from exc


def embed(text: str) -> list[float]:
    """Embed a single text (L2-normalised)."""
    return _model().encode(text, normalize_embeddings=True).tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts (L2-normalised)."""
    return _model().encode(texts, normalize_embeddings=True).tolist()
