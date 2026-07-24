import os
import re
import time
from logger import get_logger

logger = get_logger("kb.extractor")

SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md"}


def extract_text(file_path: str) -> str:
    start_time = time.perf_counter()
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        logger.warning(
            "KB extract: unsupported file type",
            path=file_path,
            extension=ext,
        )
        raise ValueError(f"Unsupported file type: {ext}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}")

    logger.info(
        "KB extraction started",
        path=file_path,
        extension=ext,
    )

    if ext == ".pdf":
        text = _extract_pdf(file_path)
    elif ext == ".txt":
        text = _extract_txt(file_path)
    elif ext == ".md":
        text = _extract_markdown(file_path)
    else:
        text = ""

    total_ms = round((time.perf_counter() - start_time) * 1000, 1)
    logger.info(
        "KB extraction complete",
        path=file_path,
        extension=ext,
        chars=len(text),
        words=len(text.split()),
        duration_ms=total_ms,
    )

    return text


def _extract_pdf(file_path: str) -> str:
    try:
        import fitz  # PyMuPDF
        start_time = time.perf_counter()
        doc = fitz.open(file_path)
        pages = []
        empty_pages = 0
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                pages.append(text.strip())
            else:
                empty_pages += 1
        doc.close()
        text = "\n\n".join(pages)

        extract_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB PDF extracted",
            path=file_path,
            total_pages=len(pages) + empty_pages,
            pages_with_text=len(pages),
            empty_pages=empty_pages,
            chars=len(text),
            extract_ms=extract_ms,
        )
        return text
    except ImportError:
        logger.error("KB PDF extraction failed: PyMuPDF not installed", path=file_path)
        raise RuntimeError("PyMuPDF not installed. Run: pip install PyMuPDF")
    except Exception as e:
        logger.error(
            "KB PDF extraction failed",
            path=file_path,
            error=str(e),
            exc_info=True,
        )
        raise


def _extract_txt(file_path: str) -> str:
    try:
        start_time = time.perf_counter()
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()

        extract_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB TXT extracted",
            path=file_path,
            chars=len(text),
            words=len(text.split()),
            extract_ms=extract_ms,
        )
        return text
    except Exception as e:
        logger.error(
            "KB TXT extraction failed",
            path=file_path,
            error=str(e),
            exc_info=True,
        )
        raise


def _extract_markdown(file_path: str) -> str:
    try:
        start_time = time.perf_counter()
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()

        original_len = len(text)

        # Strip markdown syntax for better embedding quality
        text = re.sub(r"#{1,6}\s+", "", text)          # headings
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)    # bold
        text = re.sub(r"\*(.+?)\*", r"\1", text)         # italic
        text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)    # code blocks
        text = re.sub(r"!\[.*?\]\(.*?\)", "", text)       # images
        text = re.sub(r"\[(.+?)\]\(.*?\)", r"\1", text)  # links
        text = re.sub(r"^[-*+]\s+", "", text, flags=re.MULTILINE)  # list markers
        text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)  # numbered lists

        stripped_chars = original_len - len(text)
        extract_ms = round((time.perf_counter() - start_time) * 1000, 1)
        logger.info(
            "KB Markdown extracted",
            path=file_path,
            chars=len(text),
            words=len(text.split()),
            chars_stripped=stripped_chars,
            extract_ms=extract_ms,
        )
        return text
    except Exception as e:
        logger.error(
            "KB Markdown extraction failed",
            path=file_path,
            error=str(e),
            exc_info=True,
        )
        raise
