"""
Structured logging for AntiBurnout backend.

Usage:
    from logger import get_logger, log_ai_call

    logger = get_logger("chat")
    logger.info("Message received", user_id="123", model="gpt-4")

    @log_ai_call("chat.send")
    async def send_message(...):
        ...
"""

import logging
import time
import functools
import asyncio
import threading
from datetime import datetime, timezone
from typing import Optional, Any

# Log levels
DEBUG = logging.DEBUG
INFO = logging.INFO
WARNING = logging.WARNING
ERROR = logging.ERROR

# Lock for thread-safe handler initialization
_handler_lock = threading.Lock()

# Structured fields that get extracted from log records
STRUCTURED_FIELDS = [
    "user_id", "model", "session_id", "tokens", "duration_ms",
    "tool", "score", "chunk_count", "error_type", "provider",
    "input_tokens", "output_tokens", "total_tokens", "context_pct",
    "status", "endpoint", "method", "latency_ms", "query",
    "result_count", "recommendation_count", "tools_used",
    "message_length", "history_turns", "path", "device",
    "k", "top_score", "collection", "error",
    "upload_filename", "content_type", "file_size_kb", "doc_id",
    "file_type", "chars", "words", "pages", "total_pages",
    "pages_with_text", "empty_pages", "extract_ms", "store_ms",
    "embed_ms", "search_ms", "fetch_ms", "delete_ms",
    "chunk_size", "chunk_overlap", "total_chunks", "chunks_deleted",
    "raw_results", "unique_docs", "doc_count", "chars_stripped",
]


def _format_value(key: str, val) -> str:
    """Format a structured field value for display."""
    if isinstance(val, list):
        if not val:
            return f"{key}=[]"
        items = ", ".join(str(v) for v in val[:5])
        if len(val) > 5:
            items += f"... +{len(val) - 5} more"
        return f"{key}=[{items}]"
    if isinstance(val, dict):
        items = ", ".join(f"{k}={v}" for k, v in list(val.items())[:3])
        return f"{key}={{{items}}}"
    if isinstance(val, float):
        return f"{key}={val:.4f}"
    return f"{key}={val}"


class StructuredLogger(logging.Logger):
    """Logger that accepts structured fields as direct kwargs.

    Usage:
        logger.info("Message received", user_id="123", model="gpt-4")
    """

    def _log_with_extra(self, level, msg, args, kwargs):
        """Extract structured fields and pass them via extra."""
        extra = kwargs.pop("extra", None) or {}
        exc_info = kwargs.pop("exc_info", False)
        # Any remaining kwargs become structured fields
        extra.update(kwargs)
        record = self.makeRecord(self.name, level, "", 0, msg, args, exc_info, extra=extra)
        self.handle(record)

    def debug(self, msg, *args, **kwargs):
        if self.isEnabledFor(DEBUG):
            self._log_with_extra(DEBUG, msg, args, kwargs)

    def info(self, msg, *args, **kwargs):
        if self.isEnabledFor(INFO):
            self._log_with_extra(INFO, msg, args, kwargs)

    def warning(self, msg, *args, **kwargs):
        if self.isEnabledFor(WARNING):
            self._log_with_extra(WARNING, msg, args, kwargs)

    def error(self, msg, *args, **kwargs):
        if self.isEnabledFor(ERROR):
            self._log_with_extra(ERROR, msg, args, kwargs)


class StructuredFormatter(logging.Formatter):
    """Formats log records as structured text with context."""

    COLORS = {
        "DEBUG": "\033[36m",     # cyan
        "INFO": "\033[32m",      # green
        "WARNING": "\033[33m",   # yellow
        "ERROR": "\033[31m",     # red
    }
    RESET = "\033[0m"

    def __init__(self, use_color: bool = True):
        super().__init__()
        self.use_color = use_color

    def format(self, record):
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]

        level = record.levelname.ljust(7)
        if self.use_color:
            color = self.COLORS.get(record.levelname, "")
            level = f"{color}{level}{self.RESET}"

        module = record.name.split(".")[-1] if "." in record.name else record.name

        parts = [f"[{ts}] [{level}] [{module}] {record.getMessage()}"]

        # Extract structured fields from record's _structured dict
        extras = {}
        structured = getattr(record, "_structured", {})
        for key in STRUCTURED_FIELDS:
            val = structured.get(key, None)
            if val is not None:
                extras[key] = val

        if extras:
            pairs = " ".join(_format_value(k, v) for k, v in extras.items())
            parts.append(f"  {pairs}")

        if record.exc_info and isinstance(record.exc_info, tuple) and record.exc_info[0]:
            parts.append(f"  exception={record.exc_info[0].__name__}: {record.exc_info[1]}")

        return "".join(parts)


class StructuredFilter(logging.Filter):
    """Collects structured fields from record attributes into record._structured."""

    def filter(self, record):
        # Skip if already processed by an earlier filter in the chain
        if hasattr(record, "_structured"):
            return True

        structured = {}
        for key in STRUCTURED_FIELDS:
            val = getattr(record, key, None)
            if val is not None:
                structured[key] = val
                try:
                    delattr(record, key)
                except AttributeError:
                    pass
        record._structured = structured
        return True


def get_logger(name: str, level: int = INFO) -> StructuredLogger:
    """Get a configured logger instance.

    Thread-safe: handlers are only added once even under concurrent access.

    Args:
        name: Logger name (e.g., "chat", "rag", "agent")
        level: Log level (DEBUG, INFO, WARNING, ERROR)

    Returns:
        StructuredLogger instance that accepts kwargs as structured fields
    """
    logger = logging.getLogger(f"antiburnout.{name}")

    with _handler_lock:
        if logger.handlers:
            return logger

        # Replace the logger class with our StructuredLogger
        logger.__class__ = StructuredLogger
        logger.setLevel(level)

        # Add filter to process structured fields
        logger.addFilter(StructuredFilter())

        # Console handler (human-readable with colors)
        console_handler = logging.StreamHandler()
        console_handler.setLevel(level)
        console_handler.setFormatter(StructuredFormatter(use_color=True))
        console_handler.addFilter(StructuredFilter())
        logger.addHandler(console_handler)

    return logger


def _sanitize_kwargs(kwargs: dict) -> dict:
    """Sanitize keyword arguments for logging (hide secrets, truncate long values)."""
    safe = {}
    for k, v in kwargs.items():
        if k in ("api_key", "token", "password", "secret"):
            safe[k] = f"{str(v)[:8]}..." if v else None
        elif isinstance(v, (str, int, float, bool)):
            safe[k] = v
        elif isinstance(v, dict):
            safe[k] = str(v)[:100]
        elif isinstance(v, list):
            safe[k] = v[:5] if len(v) > 5 else v
        else:
            safe[k] = type(v).__name__
    return safe


def _extract_result_data(result) -> dict:
    """Extract useful structured data from a function's return value for logging."""
    log_data = {}
    if isinstance(result, tuple):
        if len(result) >= 4:
            tools = result[2] if result[2] else []
            log_data["tools_used"] = tools
            token_usage = result[3]
            if isinstance(token_usage, dict) and token_usage:
                log_data["input_tokens"] = token_usage.get("input_tokens", 0)
                log_data["output_tokens"] = token_usage.get("output_tokens", 0)
                log_data["total_tokens"] = token_usage.get("total_tokens", 0)
        elif len(result) >= 3:
            log_data["tools_used"] = result[2] if result[2] else []
    elif isinstance(result, dict):
        if "score" in result:
            log_data["score"] = result["score"]
        if "count" in result:
            log_data["result_count"] = result["count"]
    return log_data


def log_ai_call(feature: str, level: int = INFO):
    """Decorator that logs AI function calls with timing and context.

    Automatically logs:
        - Function entry with sanitized arguments
        - Function exit with return value data and duration
        - Exceptions with full traceback

    Args:
        feature: Feature name for logging (e.g., "chat.send", "rag.search")
        level: Log level

    Example:
        @log_ai_call("chat.send")
        async def send_message(token, request):
            ...
    """
    def decorator(func):
        logger = get_logger(feature.split(".")[0])

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            start_time = time.perf_counter()
            safe_kwargs = _sanitize_kwargs(kwargs)

            logger.log(level, f"→ {func.__name__}", status="START", **safe_kwargs)

            try:
                result = await func(*args, **kwargs)
                duration_ms = round((time.perf_counter() - start_time) * 1000, 1)

                log_data = {"duration_ms": duration_ms, "status": "OK"}
                log_data.update(_extract_result_data(result))

                logger.log(level, f"← {func.__name__}", **log_data)
                return result

            except Exception as e:
                duration_ms = round((time.perf_counter() - start_time) * 1000, 1)
                logger.error(
                    f"✗ {func.__name__} failed",
                    status="ERROR",
                    duration_ms=duration_ms,
                    error_type=type(e).__name__,
                    exc_info=True,
                )
                raise

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            start_time = time.perf_counter()
            safe_kwargs = _sanitize_kwargs(kwargs)

            logger.log(level, f"→ {func.__name__}", status="START", **safe_kwargs)

            try:
                result = func(*args, **kwargs)
                duration_ms = round((time.perf_counter() - start_time) * 1000, 1)

                log_data = {"duration_ms": duration_ms, "status": "OK"}
                log_data.update(_extract_result_data(result))

                logger.log(level, f"← {func.__name__}", **log_data)
                return result

            except Exception as e:
                duration_ms = round((time.perf_counter() - start_time) * 1000, 1)
                logger.error(
                    f"✗ {func.__name__} failed",
                    status="ERROR",
                    duration_ms=duration_ms,
                    error_type=type(e).__name__,
                    exc_info=True,
                )
                raise

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


# Pre-configured loggers for each AI feature
chat_logger = get_logger("chat")
rag_logger = get_logger("rag")
agent_logger = get_logger("agent")
db_logger = get_logger("db")
api_logger = get_logger("api")
