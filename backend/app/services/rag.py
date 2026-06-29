"""
RAG service — ChromaDB (local persistent) + sentence-transformers.

Documents are chunked, embedded, and stored.  At query time the top-K
most-relevant chunks are retrieved and can be injected into prompts.
"""

from __future__ import annotations
import os
from functools import lru_cache
from typing import Optional

from . import embeddings as emb

# ── Storage path ──────────────────────────────────────────────────────────────

_HERE = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.path.join(_HERE, "../../chroma_db")
COLLECTION  = "pclick_docs"

# ── Chunking params ───────────────────────────────────────────────────────────

CHUNK_WORDS   = 400
OVERLAP_WORDS = 40
MIN_CHUNK_LEN = 60   # discard very short chunks


# ── Singleton collection ──────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _col():
    import chromadb
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    return client.get_or_create_collection(
        COLLECTION,
        metadata={"hnsw:space": "cosine"},
    )


# ── Text chunking ─────────────────────────────────────────────────────────────

def _chunk(text: str) -> list[str]:
    words = text.split()
    chunks: list[str] = []
    i = 0
    while i < len(words):
        c = " ".join(words[i : i + CHUNK_WORDS])
        if len(c) >= MIN_CHUNK_LEN:
            chunks.append(c)
        i += CHUNK_WORDS - OVERLAP_WORDS
    return chunks


# ── Write ─────────────────────────────────────────────────────────────────────

def add_document(doc_id: str, text: str, meta: dict) -> int:
    """Chunk → embed → upsert.  Returns number of chunks stored."""
    col = _col()
    chunks = _chunk(text)
    if not chunks:
        return 0

    vecs  = emb.embed_batch(chunks)
    ids   = [f"{doc_id}__c{i}" for i in range(len(chunks))]
    metas = [{**meta, "doc_id": doc_id, "chunk_idx": i} for i in range(len(chunks))]

    col.upsert(ids=ids, embeddings=vecs, documents=chunks, metadatas=metas)
    return len(chunks)


def delete_document(doc_id: str) -> int:
    """Delete every chunk that belongs to doc_id.  Returns count."""
    col = _col()
    existing = col.get(where={"doc_id": doc_id}, include=[])
    ids = existing["ids"]
    if ids:
        col.delete(ids=ids)
    return len(ids)


# ── Read ──────────────────────────────────────────────────────────────────────

def list_documents() -> list[dict]:
    """Return one entry per unique doc_id with aggregated metadata."""
    col = _col()
    if col.count() == 0:
        return []

    all_meta = col.get(include=["metadatas"])["metadatas"]
    seen: dict[str, dict] = {}
    for m in all_meta:
        did = m.get("doc_id", "unknown")
        if did not in seen:
            seen[did] = {
                "doc_id":      did,
                "title":       m.get("title", did),
                "subject":     m.get("subject", ""),
                "file_type":   m.get("file_type", ""),
                "chunk_count": 0,
            }
        seen[did]["chunk_count"] += 1

    return sorted(seen.values(), key=lambda d: d["title"])


def search(
    query: str,
    n: int = 5,
    subject: Optional[str] = None,
) -> list[dict]:
    """Return top-n relevant chunks for query (cosine similarity)."""
    col = _col()
    total = col.count()
    if total == 0:
        return []

    vec = emb.embed(query)
    kwargs: dict = {
        "query_embeddings": [vec],
        "n_results":        min(n, total),
        "include":          ["documents", "metadatas", "distances"],
    }
    if subject:
        kwargs["where"] = {"subject": subject}

    res = col.query(**kwargs)
    return [
        {
            "text":    doc,
            "meta":    meta,
            "score":   round(1.0 - dist, 4),
        }
        for doc, meta, dist in zip(
            res["documents"][0],
            res["metadatas"][0],
            res["distances"][0],
        )
    ]


def context_for(query: str, n: int = 3) -> str:
    """
    Return formatted reference context to inject into a system prompt.
    Empty string if no documents are indexed yet.
    """
    chunks = search(query, n=n)
    if not chunks:
        return ""
    parts = [f"[Ref {i+1}] {c['text']}" for i, c in enumerate(chunks)]
    return "\n\n".join(parts)
