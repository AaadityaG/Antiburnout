# AntiBurnout Knowledge Base — How It Works

## Overview

The AntiBurnout Knowledge Base (KB) allows users to upload personal documents (PDFs, text files, markdown notes) and have the AI wellness agent search them when answering questions. This is a **Retrieval-Augmented Generation (RAG)** system — the AI doesn't just rely on its training data, it retrieves relevant excerpts from your uploaded documents and uses them as context for its responses.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React)                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ChatOverlay  │  │ KnowledgeBase│  │  kbSlice     │  │
│  │ (input area) │  │ (doc panel)  │  │ (Redux state)│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│    POST /kb/upload   GET /kb/documents  POST /kb/search │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │
┌─────────┼─────────────────┼─────────────────┼───────────┐
│  Backend (FastAPI)         │                 │           │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐  │
│  │ routes.py    │  │ extractor.py │  │ vector_store │  │
│  │ (API layer)  │  │ (text parse) │  │ (ChromaDB)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│  ┌──────┴─────────────────┴─────────────────┴───────┐  │
│  │              Agent (LangGraph)                    │  │
│  │  ┌──────────┐                                    │  │
│  │  │ kb_search│──→ search_knowledge_base() ──→ KB  │  │
│  │  │ tool     │    (auto-called by AI)             │  │
│  │  └──────────┘                                    │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Step-by-Step: What Happens When You Upload a Document

### 1. User Uploads a File

The frontend sends a `POST /kb/upload` request with the file and auth token.

```
Frontend                    Backend
   │                           │
   │── POST /kb/upload ───────→│
   │   (file + token)          │
```

### 2. File Type Validation

In `routes.py`, the backend checks the file type:

```python
SUPPORTED_TYPES = {
    "application/pdf": ".pdf",
    "text/plain":      ".txt",
    "text/markdown":   ".md",
}
```

Only PDF, TXT, and MD files are accepted. The MIME type is checked first; if that fails, the file extension is checked as a fallback.

### 3. Save to Temp File

The uploaded file is saved to a temporary location on disk:

```python
with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
    content = await file.read()
    tmp.write(content)
    tmp_path = tmp.name
```

### 4. Text Extraction (`extractor.py`)

The raw text is extracted from the file using format-specific extractors:

**PDF → PyMuPDF (`fitz`):**
- Opens the PDF with `fitz.open()`
- Iterates every page, calls `page.get_text()` to extract text
- Empty pages (e.g., images-only pages) are counted but skipped
- Pages are joined with `\n\n` (double newline = paragraph break)
- Returns: `"Page 1 text\n\nPage 2 text\n\nPage 3 text"`

**TXT → Python `open()`:**
- Reads the file as UTF-8 with `errors="replace"` (handles encoding issues)
- Returns the raw text as-is

**Markdown → Python `open()` + regex stripping:**
- Reads the file as UTF-8
- **Strips markdown syntax** for cleaner embeddings:
  - `# Heading` → `Heading` (remove heading markers)
  - `**bold**` → `bold` (remove bold markers)
  - `*italic*` → `italic` (remove italic markers)
  - `` `code` `` → removed (code blocks stripped)
  - `![alt](url)` → removed (images removed)
  - `[text](url)` → `text` (links simplified to text)
  - `- item` → `item` (list markers removed)
  - `1. item` → `item` (numbered list markers removed)
- This is important because markdown syntax characters add noise to embeddings. The meaning is preserved without the formatting.

### 5. Generate a Document ID

A UUID is generated for the document:

```python
doc_id = str(uuid.uuid4())  # e.g., "a3f2b1c4-5678-90ab-cdef-1234567890ab"
```

This ID is used to track all chunks belonging to this document.

### 6. Page Count (PDF only)

If the file is a PDF, PyMuPDF counts the total pages:

```python
import fitz
doc = fitz.open(tmp_path)
page_count = len(doc)
doc.close()
```

### 7. Chunking (`vector_store.py`)

The extracted text is split into overlapping chunks:

```python
CHUNK_SIZE = 300    # max words per chunk
CHUNK_OVERLAP = 50  # words repeated between consecutive chunks
```

**How chunking works:**

```
Original text: [word1 word2 word3 ... word1000]

Chunk 1: word1 ... word300
Chunk 2: word251 ... word550     (50 words overlap with Chunk 1)
Chunk 3: word501 ... word800     (50 words overlap with Chunk 2)
Chunk 4: word751 ... word1000    (50 words overlap with Chunk 3)
```

**Why overlap matters:** Without overlap, a sentence like "The optimal sleep duration is 7-8 hours" could be split as:
- Chunk 1 ends: "...recommended sleep duration is"
- Chunk 2 starts: "7-8 hours per night..."

If someone searches "sleep duration", neither chunk alone contains the full phrase. With 50-word overlap, both chunks would contain the complete sentence.

**If the text is short enough (≤300 words):** It's stored as a single chunk with no splitting.

### 8. Create Metadata for Each Chunk

Each chunk gets metadata that's stored alongside it:

```python
metadatas.append({
    "doc_id":       doc_id,           # Links chunks to their parent document
    "filename":     filename,         # Original filename (e.g., "burnout-tips.pdf")
    "file_type":    file_type,        # "pdf", "txt", or "md"
    "chunk_index":  i,                # Which chunk this is (0, 1, 2, ...)
    "total_chunks": len(chunks),      # Total chunks for this document
    "page_count":   page_count,       # Total pages (PDF only)
})
```

Chunk IDs follow the pattern: `{doc_id}_c0`, `{doc_id}_c1`, `{doc_id}_c2`, ...

### 9. Embed and Store in ChromaDB

The chunks are embedded and stored:

```python
collection.add_texts(texts=texts, ids=ids, metadatas=metadatas)
```

**What happens internally:**
1. Each text chunk is sent to the embedding model (reused from the RAG module via `rag.vector_store.get_embeddings()`)
2. The embedding model converts each chunk into a **vector** — an array of ~384 numbers that capture the semantic meaning
3. ChromaDB stores: the original text, the vector, the ID, and the metadata
4. Data is persisted to disk at `kb/chroma_db/`

**Per-user isolation:** Each user gets their own ChromaDB collection named `kb_{user_id}`. User A cannot see User B's documents.

```
kb/chroma_db/
├── kb_97d95d5c_daf6_4371_bea7_2ccbf4524d5f/    ← User A's collection
│   ├── chroma.sqlite3
│   └── ...
├── kb_abc123_def4_5678_9012_abcdef123456/        ← User B's collection
│   ├── chroma.sqlite3
│   └── ...
```

---

## Step-by-Step: What Happens When You Ask a Question

### 1. User Sends a Chat Message

The frontend sends `POST /chat/send` with the message, token, conversation history, system metrics, and model key.

### 2. Agent Invocation

In `chat.py`, the backend calls `run_agent()` which compiles a LangGraph agent with 6 tools:

```python
tools = [
    check_settings_with_metrics,
    get_user_activity,
    get_user_break_settings,
    get_break_tip,
    recommend_music,
    kb_search,              # ← Knowledge Base search tool
]
```

The LLM (GPT-4o-mini via OpenRouter) receives the user's message along with the system prompt and tool definitions.

### 3. LLM Decides Whether to Search KB

The LLM examines the user's message and decides if the `kb_search` tool should be called. The tool description tells it when to use it:

```python
"""Search the user's personal knowledge base for relevant information. 
Call this when the user asks about their uploaded documents, studies, 
research, or any content they've added to their knowledge base."""
```

**Example:** If the user asks "What does my burnout tips document say about sleep?", the LLM will call `kb_search`.

### 4. KB Search Executes

The `kb_search` tool calls `search_knowledge_base()` from `tools.py`:

```python
@tool
def search_knowledge_base(user_id: str, query: str) -> dict:
    from kb.vector_store import search_documents
    results = search_documents(user_id, query, k=3)
    # ... format and return results
```

### 5. Vector Similarity Search (`vector_store.py`)

The `search_documents()` function:

```python
collection = _get_user_collection(user_id)
results = collection.similarity_search_with_relevance_scores(query, k=3)
```

**What happens internally:**
1. The user's query ("What does my document say about sleep?") is embedded using the same model
2. ChromaDB compares the query vector against all stored vectors using **cosine similarity**
3. The top-k (3) most similar chunks are returned with their relevance scores (0.0 to 1.0)
4. Chunks from the same document are merged together — their text is concatenated and the highest score is kept

**Example results:**
```python
[
    {
        "doc_id": "a3f2b1c4-...",
        "filename": "burnout-tips.md",
        "file_type": "md",
        "score": 0.8742,          # High relevance
        "content": "Sleep Hygiene...\n\nSleep plays a critical role...",
        "chunk_index": 5,
        "total_chunks": 8,
    }
]
```

### 6. Results Sent Back to LLM

The search results are returned to the LLM as tool output. The LLM now has:
- The original user question
- The relevant excerpts from the uploaded document
- Relevance scores indicating how well each excerpt matches

### 7. LLM Generates Response Using KB Context

The LLM synthesizes an answer using the retrieved context. For example:

**User:** "What does my document say about sleep?"

**LLM response (using KB results):**
> Based on your uploaded document, here are the key sleep recommendations:
> - Maintain a consistent bedtime, even on weekends
> - Keep your room cool (65-68°F / 18-20°C)
> - No caffeine after 2 PM
> - No screens 1 hour before bed
> - The document also notes that you need 2-3 days of normal sleep per hour of sleep debt...

The response includes a `📚 Knowledge base searched` indicator in the frontend.

---

## The `list_documents` Endpoint

When the Knowledge Base panel opens, the frontend calls `GET /kb/documents`:

1. Fetches ALL chunk metadata from the user's ChromaDB collection
2. Groups chunks by `doc_id` to reconstruct the document list
3. Returns: document ID, filename, file type, page count, total chunks

```python
# From vector_store.py
all_data = collection.get()  # Get all chunks
docs = {}
for meta in all_data["metadatas"]:
    doc_id = meta.get("doc_id", "")
    if doc_id not in docs:
        docs[doc_id] = {
            "doc_id": doc_id,
            "filename": meta.get("filename", ""),
            "file_type": meta.get("file_type", ""),
            "page_count": meta.get("page_count", 1),
            "total_chunks": meta.get("total_chunks", 1),
        }
```

---

## The `delete_document` Endpoint

When a user deletes a document via `DELETE /kb/documents/{doc_id}`:

1. Fetches all chunk IDs from the collection
2. Filters to find IDs matching the `doc_id` (e.g., `a3f2b1c4-..._c0`, `_c1`, `_c2`, ...)
3. Deletes all matching chunk IDs from ChromaDB

```python
ids_to_delete = [
    id_ for id_, meta in zip(all_data["ids"], all_data["metadatas"])
    if meta.get("doc_id") == doc_id
]
collection.delete(ids=ids_to_delete)
```

---

## Embedding Model

The KB reuses the same embedding model from the RAG module:

```python
def _get_embeddings():
    from rag.vector_store import get_embeddings
    return get_embeddings()
```

This is **all-MiniLM-L6-v2** (from the `sentence-transformers` library):
- 384-dimensional vectors
- Max 512 tokens input (~384 words)
- Fast inference, good quality for retrieval
- Runs locally (no API calls to OpenAI for embeddings)

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Word-level chunking** (not character) | Preserves word boundaries; no broken words |
| **50-word overlap** | Balances context preservation with storage efficiency |
| **Per-user collections** | Data isolation; User A never sees User B's docs |
| **Markdown syntax stripping** | Cleaner embeddings; `#` and `**` add noise, not meaning |
| **Local embeddings** | No latency or cost from external API calls |
| **Cosine similarity** | Standard for semantic search; measures angle between vectors |
| **Result merging by doc_id** | Multiple chunks from same doc are combined into one result |
| **k=3 for agent search** | Keeps context compact; avoids overwhelming the LLM |
| **k=5 for direct API search** | More results when searching from the KB panel |

---

## Data Flow Summary

```
UPLOAD:
  File → Validate → Extract Text → Chunk → Embed → Store in ChromaDB
                                                              ↓
                                                    kb/chroma_db/kb_{user_id}/

SEARCH:
  User Question → Embed Query → Cosine Similarity Search → Top-k Chunks
                                                              ↓
                                                     Merge by doc_id
                                                              ↓
                                                     Format + Return to LLM
                                                              ↓
                                                     LLM generates answer
                                                     using retrieved context
```

---

## File Locations

```
backend/
├── kb/
│   ├── __init__.py          # Exports kb_router
│   ├── routes.py            # FastAPI endpoints (upload, list, delete, search)
│   ├── extractor.py         # PDF/TXT/MD text extraction
│   ├── vector_store.py      # ChromaDB operations (store, search, list, delete)
│   └── chroma_db/           # Persistent vector storage (auto-created)
│       └── kb_{user_id}/    # Per-user collection
├── agent/
│   ├── graph.py             # LangGraph agent with kb_search tool
│   └── tools.py             # search_knowledge_base() tool definition
├── rag/
│   └── vector_store.py      # Embedding model (shared with KB)
└── main.py                  # Includes kb_router
```
