import os
import uuid
import tempfile
import time
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from auth import verify_token
from logger import get_logger

logger = get_logger("kb.routes")

router = APIRouter(prefix="/kb", tags=["Knowledge Base"])

SUPPORTED_TYPES = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
}


class KBSearchRequest(BaseModel):
    query: str
    k: int = 5


class KBSearchResult(BaseModel):
    doc_id: str
    filename: str
    file_type: str
    score: float
    content: str


class KBDocument(BaseModel):
    doc_id: str
    filename: str
    file_type: str
    page_count: int
    total_chunks: int


class KBUploadResponse(BaseModel):
    doc_id: str
    filename: str
    file_type: str
    page_count: int
    total_chunks: int


@router.post("/upload", response_model=KBUploadResponse)
async def upload_document(token: str, file: UploadFile = File(...)):
    start_time = time.perf_counter()
    user_id = None
    try:
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = payload.get("sub")
        logger.info(
            "KB upload started",
            user_id=user_id,
            upload_filename=file.filename,
            content_type=file.content_type,
        )

        # Validate file type
        content_type = file.content_type
        if content_type not in SUPPORTED_TYPES:
            ext = os.path.splitext(file.filename or "")[1].lower()
            if ext not in {".pdf", ".txt", ".md"}:
                logger.warning(
                    "KB upload rejected: unsupported file type",
                    user_id=user_id,
                    upload_filename=file.filename,
                    content_type=content_type,
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {content_type}. Supported: PDF, TXT, MD",
                )
            file_ext = ext
        else:
            file_ext = SUPPORTED_TYPES[content_type]

        # Save uploaded file to temp location
        doc_id = str(uuid.uuid4())
        suffix = file_ext or ".pdf"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        file_size_kb = round(len(content) / 1024, 2)
        logger.info(
            "KB file saved to temp",
            user_id=user_id,
            doc_id=doc_id,
            file_size_kb=file_size_kb,
            path=tmp_path,
        )

        try:
            from kb.extractor import extract_text
            from kb.vector_store import store_document

            extract_start = time.perf_counter()
            text = extract_text(tmp_path)
            extract_ms = round((time.perf_counter() - extract_start) * 1000, 1)

            if not text.strip():
                logger.warning(
                    "KB upload failed: no text extracted",
                    user_id=user_id,
                    doc_id=doc_id,
                    upload_filename=file.filename,
                )
                raise HTTPException(status_code=400, detail="Could not extract text from file. The file may be empty or image-based.")

            # Count pages for PDFs
            page_count = 1
            if suffix == ".pdf":
                try:
                    import fitz
                    doc = fitz.open(tmp_path)
                    page_count = len(doc)
                    doc.close()
                except Exception:
                    page_count = 1

            logger.info(
                "KB text extracted",
                user_id=user_id,
                doc_id=doc_id,
                upload_filename=file.filename,
                chars=len(text),
                pages=page_count,
                extract_ms=extract_ms,
            )

            store_start = time.perf_counter()
            chunk_count = store_document(
                user_id=user_id,
                doc_id=doc_id,
                filename=file.filename or f"document{suffix}",
                file_type=suffix.lstrip("."),
                text=text,
                page_count=page_count,
            )
            store_ms = round((time.perf_counter() - store_start) * 1000, 1)

            total_ms = round((time.perf_counter() - start_time) * 1000, 1)
            logger.info(
                "KB document uploaded",
                user_id=user_id,
                doc_id=doc_id,
                upload_filename=file.filename,
                file_type=suffix.lstrip("."),
                chars=len(text),
                chunks=chunk_count,
                pages=page_count,
                file_size_kb=file_size_kb,
                extract_ms=extract_ms,
                store_ms=store_ms,
                duration_ms=total_ms,
            )

            return KBUploadResponse(
                doc_id=doc_id,
                filename=file.filename or f"document{suffix}",
                file_type=suffix.lstrip("."),
                page_count=page_count,
                total_chunks=chunk_count,
            )
        finally:
            os.unlink(tmp_path)

    except HTTPException:
        raise
    except Exception as e:
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.error(
            "KB upload failed",
            user_id=user_id,
            upload_filename=file.filename,
            error=str(e),
            duration_ms=total_ms,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/documents", response_model=list[KBDocument])
async def list_documents(token: str):
    start_time = time.perf_counter()
    user_id = None
    try:
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = payload.get("sub")
        logger.info("KB list documents", user_id=user_id)

        from kb.vector_store import list_documents
        docs = list_documents(user_id)

        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB documents listed",
            user_id=user_id,
            result_count=len(docs),
            duration_ms=total_ms,
        )
        return docs

    except HTTPException:
        raise
    except Exception as e:
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.error(
            "KB list failed",
            error=str(e),
            duration_ms=total_ms,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/documents/{doc_id}")
async def delete_document(token: str, doc_id: str):
    start_time = time.perf_counter()
    user_id = None
    try:
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = payload.get("sub")
        logger.info(
            "KB delete started",
            user_id=user_id,
            doc_id=doc_id,
        )

        from kb.vector_store import delete_document
        deleted = delete_document(user_id, doc_id)

        if not deleted:
            logger.warning(
                "KB delete failed: document not found",
                user_id=user_id,
                doc_id=doc_id,
            )
            raise HTTPException(status_code=404, detail="Document not found")

        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB document deleted",
            user_id=user_id,
            doc_id=doc_id,
            duration_ms=total_ms,
        )

        return {"message": "Document deleted", "doc_id": doc_id}

    except HTTPException:
        raise
    except Exception as e:
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.error(
            "KB delete failed",
            user_id=user_id,
            doc_id=doc_id,
            error=str(e),
            duration_ms=total_ms,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def search_knowledge_base(token: str, request: KBSearchRequest):
    start_time = time.perf_counter()
    user_id = None
    try:
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = payload.get("sub")
        logger.info(
            "KB search started",
            user_id=user_id,
            query=request.query,
            k=request.k,
        )

        from kb.vector_store import search_documents
        results = search_documents(user_id, request.query, k=request.k)

        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        top_score = results[0]["score"] if results else None
        logger.info(
            "KB search completed",
            user_id=user_id,
            query=request.query,
            k=request.k,
            result_count=len(results),
            top_score=top_score,
            duration_ms=total_ms,
        )

        return {
            "results": results,
            "query": request.query,
            "total": len(results),
        }

    except HTTPException:
        raise
    except Exception as e:
        total_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.error(
            "KB search failed",
            user_id=user_id,
            query=request.query,
            error=str(e),
            duration_ms=total_ms,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))
