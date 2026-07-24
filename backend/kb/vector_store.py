import os
import time
import chromadb
from chromadb.config import Settings
from langchain_chroma import Chroma
from logger import get_logger

logger = get_logger("kb.vector_store")

CHROMA_PERSIST_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
CHUNK_SIZE = 300
CHUNK_OVERLAP = 50

# Reuse the same embedding model from the RAG module
_embedding_model = None
_chroma_client = None


def _get_embeddings():
    from rag.vector_store import get_embeddings
    return get_embeddings()


def _get_chroma_client():
    global _chroma_client
    if _chroma_client is None:
        os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
        logger.info("Initializing KB ChromaDB client", path=CHROMA_PERSIST_DIR)
        _chroma_client = chromadb.PersistentClient(
            path=CHROMA_PERSIST_DIR,
            settings=Settings(anonymized_telemetry=False),
        )
    return _chroma_client


def _get_user_collection(user_id: str) -> Chroma:
    client = _get_chroma_client()
    safe_id = user_id.replace("-", "_")
    collection_name = f"kb_{safe_id}"
    return Chroma(
        client=client,
        collection_name=collection_name,
        embedding_function=_get_embeddings(),
    )


def chunk_text(text: str) -> list[str]:
    words = text.split()
    if len(words) <= CHUNK_SIZE:
        return [text]
    chunks = []
    start = 0
    while start < len(words):
        end = start + CHUNK_SIZE
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def store_document(user_id: str, doc_id: str, filename: str, file_type: str, text: str, page_count: int = 1) -> int:
    start_time = time.perf_counter()
    collection = _get_user_collection(user_id)
    chunks = chunk_text(text)

    logger.info(
        "KB chunking complete",
        user_id=user_id,
        doc_id=doc_id,
        upload_filename=filename,
        total_words=len(text.split()),
        chunk_count=len(chunks),
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )

    texts = []
    ids = []
    metadatas = []

    for i, chunk in enumerate(chunks):
        texts.append(chunk)
        ids.append(f"{doc_id}_c{i}")
        metadatas.append({
            "doc_id": doc_id,
            "filename": filename,
            "file_type": file_type,
            "chunk_index": i,
            "total_chunks": len(chunks),
            "page_count": page_count,
        })

    embed_start = time.perf_counter()
    collection.add_texts(texts=texts, ids=ids, metadatas=metadatas)
    embed_ms = round((time.perf_counter() - embed_start) * 1000, 1)

    total_ms = round((time.perf_counter() - start_time) * 1000, 1)
    logger.info(
        "KB document stored",
        user_id=user_id,
        doc_id=doc_id,
        upload_filename=filename,
        file_type=file_type,
        chunks=len(chunks),
        embed_ms=embed_ms,
        duration_ms=total_ms,
    )
    return len(chunks)


def search_documents(user_id: str, query: str, k: int = 5) -> list[dict]:
    start_time = time.perf_counter()
    collection = _get_user_collection(user_id)

    search_start = time.perf_counter()
    results = collection.similarity_search_with_relevance_scores(query, k=k)
    search_ms = round((time.perf_counter() - search_start) * 1000, 1)

    seen_docs = {}
    for doc, score in results:
        meta = doc.metadata
        doc_id = meta.get("doc_id", "")
        if doc_id not in seen_docs:
            seen_docs[doc_id] = {
                "doc_id": doc_id,
                "filename": meta.get("filename", ""),
                "file_type": meta.get("file_type", ""),
                "score": score,
                "content": doc.page_content,
                "chunk_index": meta.get("chunk_index", 0),
                "total_chunks": meta.get("total_chunks", 1),
            }
        else:
            # Append content from additional chunks of same doc
            seen_docs[doc_id]["content"] += "\n\n" + doc.page_content
            # Keep highest score
            if score > seen_docs[doc_id]["score"]:
                seen_docs[doc_id]["score"] = score

    results_list = sorted(seen_docs.values(), key=lambda x: x["score"], reverse=True)

    total_ms = round((time.perf_counter() - start_time) * 1000, 1)
    logger.info(
        "KB search executed",
        user_id=user_id,
        query=query,
        k=k,
        raw_results=len(results),
        unique_docs=len(results_list),
        top_score=results_list[0]["score"] if results_list else None,
        search_ms=search_ms,
        duration_ms=total_ms,
    )

    return results_list


def list_documents(user_id: str) -> list[dict]:
    start_time = time.perf_counter()
    collection = _get_user_collection(user_id)

    fetch_start = time.perf_counter()
    all_data = collection.get()
    fetch_ms = round((time.perf_counter() - fetch_start) * 1000, 1)

    if not all_data or not all_data.get("metadatas"):
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB list: no documents found",
            user_id=user_id,
            duration_ms=total_ms,
        )
        return []

    docs = {}
    total_chunks = 0
    for meta in all_data["metadatas"]:
        doc_id = meta.get("doc_id", "")
        total_chunks += 1
        if doc_id not in docs:
            docs[doc_id] = {
                "doc_id": doc_id,
                "filename": meta.get("filename", ""),
                "file_type": meta.get("file_type", ""),
                "page_count": meta.get("page_count", 1),
                "total_chunks": meta.get("total_chunks", 1),
            }

    total_ms = round((time.perf_counter() - start_time) * 1000, 1)
    logger.info(
        "KB documents listed",
        user_id=user_id,
        doc_count=len(docs),
        total_chunks=total_chunks,
        fetch_ms=fetch_ms,
        duration_ms=total_ms,
    )

    return list(docs.values())


def delete_document(user_id: str, doc_id: str) -> bool:
    start_time = time.perf_counter()
    collection = _get_user_collection(user_id)

    fetch_start = time.perf_counter()
    all_data = collection.get()
    fetch_ms = round((time.perf_counter() - fetch_start) * 1000, 1)

    if not all_data or not all_data.get("ids"):
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.warning(
            "KB delete: no data in collection",
            user_id=user_id,
            doc_id=doc_id,
            duration_ms=total_ms,
        )
        return False

    ids_to_delete = [
        id_ for id_, meta in zip(all_data["ids"], all_data["metadatas"])
        if meta.get("doc_id") == doc_id
    ]

    if not ids_to_delete:
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.warning(
            "KB delete: document not found in collection",
            user_id=user_id,
            doc_id=doc_id,
            duration_ms=total_ms,
        )
        return False

    delete_start = time.perf_counter()
    collection.delete(ids=ids_to_delete)
    delete_ms = round((time.perf_counter() - delete_start) * 1000, 1)

    total_ms = round((time.perf_counter() - start_time) * 1000, 1)
    logger.info(
        "KB document deleted",
        user_id=user_id,
        doc_id=doc_id,
        chunks_deleted=len(ids_to_delete),
        delete_ms=delete_ms,
        duration_ms=total_ms,
    )
    return True


def delete_user_collection(user_id: str) -> bool:
    start_time = time.perf_counter()
    client = _get_chroma_client()
    safe_id = user_id.replace("-", "_")
    collection_name = f"kb_{safe_id}"
    try:
        client.delete_collection(collection_name)
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB user collection deleted",
            user_id=user_id,
            collection=collection_name,
            duration_ms=total_ms,
        )
        return True
    except Exception as e:
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.error(
            "KB user collection delete failed",
            user_id=user_id,
            collection=collection_name,
            error=str(e),
            duration_ms=total_ms,
        )
        return False
