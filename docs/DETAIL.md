# AntiBurnout.ai — Architecture & Features

Full documentation of the system design, features, tech stack, and API.

## Table of Contents

- [System Overview](#system-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Environment Variables](#environment-variables)
- [Backend Structure](#backend-structure)
- [Frontend Structure](#frontend-structure)
- [Agent Architecture](#agent-architecture)
- [RAG Pipeline](#rag-pipeline)
- [Data Flow](#data-flow)
- [API Reference](#api-reference)
- [Key Decisions](#key-decisions)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Desktop App                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  React   │  │  Redux   │  │  Timer   │  │   System   │  │
│  │   UI     │  │  Store   │  │ (Main)   │  │  Control   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       └──────────────┴─────────────┴──────────────┘         │
│                         │ IPC                               │
└─────────────────────────┼───────────────────────────────────┘
                          │
                    HTTP / REST
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   FastAPI Backend                            │
│  ┌──────────┐  ┌────────┴───────┐  ┌──────────────────┐    │
│  │  Auth    │  │   8 Routers    │  │    Services      │    │
│  │  (JWT)   │  │   21 Endpoints │  │  (encryption,    │    │
│  └──────────┘  └────────────────┘  │   agent_runner)  │    │
│                                     └────────┬─────────┘    │
│                                              │              │
│  ┌──────────────────┐  ┌─────────────────────┼──────────┐   │
│  │  MongoDB Atlas   │  │    LangGraph Agent             │   │
│  │  (or local JSON) │  │  ┌─────────┐  ┌──────────┐    │   │
│  └──────────────────┘  │  │  LLM    │  │  5 Tools │    │   │
│                         │  │(OpenRtr)│  │          │    │   │
│  ┌──────────────────┐  │  └─────────┘  └──────────┘    │   │
│  │  ChromaDB        │  └────────────────────────────────┘   │
│  │  (RAG vectors)   │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Features

### AI Chat Agent
- Wellness coach powered by **LangGraph** agent with 5 tools
- Auto-execute mode: applies brightness/volume changes directly
- BYOK (Bring Your Own Key): users supply their own OpenRouter API key
- Token usage tracking displayed in real-time (input/output tokens, context %)
- Conversation history with semantic search

### Break Timer
- Configurable interval and duration
- Auto-start on app launch
- Full-screen break overlay with guided exercises
- Countdown timer lives in **Electron main process** (survives React crashes)
- System tray integration

### System Control
- Reads/writes actual system **brightness** (WMI on Windows)
- Reads/writes system **volume** (native Node.js module)
- Night mode detection based on time of day

### Music Player
- Mood-based YouTube music recommendations (8 moods: stressed, anxious, tired, sad, focus, happy, sleep, meditate)
- Direct search by genre/artist/style
- Embedded YouTube IFrame player with playback controls
- Playlist queuing and ambient video backgrounds

### Chat History Search
- Semantic search using **ChromaDB** + **all-MiniLM-L6-v2** embeddings
- Overlapping chunking (300 words, 50 overlap) for long responses
- Real-time search with relevance scoring
- Per-user isolated vector collections

### Activity Insights
- Screen time tracking per session
- Break adherence analytics
- Daily/weekly activity charts

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Shell** | Electron 38 |
| **Frontend** | React 19, Redux Toolkit, Tailwind CSS 4, Framer Motion |
| **Backend** | FastAPI, Uvicorn, Pydantic |
| **AI Agent** | LangGraph, LangChain, OpenRouter (LLM gateway) |
| **Embeddings** | all-MiniLM-L6-v2 (HuggingFace, 384-dim, CPU) |
| **Vector Store** | ChromaDB (persistent, local SQLite) |
| **Database** | MongoDB Atlas (with local JSON fallback) |
| **Auth** | Device-based (machine GUID), JWT tokens |
| **Build** | Vite 8, TypeScript 6, electron-builder |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | Yes | — | JWT signing secret |
| `ALGORITHM` | No | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `30` | Token expiry |
| `MONGODB_URI` | No | — | MongoDB Atlas connection string. If missing, falls back to `local_db.json` |
| `MONGODB_DB_NAME` | No | `antiburnout` | MongoDB database name |
| `YTKEY` | No | — | YouTube Data API v3 key (for music search) |
| `PEXELS_API_KEY` | No | — | Pexels API key |
| `HOST` | No | `0.0.0.0` | Server bind host |
| `PORT` | No | `8000` | Server port |

```env
# Example backend/.env
SECRET_KEY=my-super-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net
MONGODB_DB_NAME=antiburnout
YTKEY=AIzaSy...
```

### Frontend (`desk-app/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend API URL |

```env
# Example desk-app/.env
VITE_API_URL=http://localhost:8000
```

---

## Backend Structure

```
backend/
├── main.py                    # FastAPI app, CORS, router mounts
├── auth.py                    # JWT create/verify
├── logger.py                  # Structured logging (terminal output)
├── requirements.txt           # 16 Python dependencies
├── .env.example               # Environment template
│
├── agent/                     # AI agent
│   ├── graph.py               # LangGraph StateGraph + system prompt (180 lines)
│   └── tools.py               # 5 LangChain tools (293 lines)
│
├── db/                        # Database layer
│   ├── connection.py          # MongoDB + JSON fallback
│   ├── users.py               # User CRUD
│   ├── settings.py            # Break settings
│   ├── chat_history.py        # Chat sessions
│   └── activity.py            # Activity tracking
│
├── routers/                   # API endpoints (8 routers, 21 endpoints)
│   ├── device_auth.py         # Auth (4 endpoints)
│   ├── chat.py                # Chat send (1 endpoint)
│   ├── chat_history.py        # History + search (5 endpoints)
│   ├── settings.py            # Break settings (2 endpoints)
│   ├── activity.py            # Activity (3 endpoints)
│   ├── agent.py               # Recommendations (2 endpoints)
│   ├── tips.py                # AI tips (1 endpoint)
│   └── music.py               # Music search (3 endpoints)
│
├── rag/                       # RAG pipeline
│   ├── vector_store.py        # ChromaDB + embeddings + chunking
│   └── chroma_db/             # Persistent vector storage
│
├── kb/                        # Knowledge Base (personal docs)
│   ├── extractor.py           # Text extraction (PDF, TXT, MD)
│   ├── vector_store.py        # ChromaDB per-user KB collection
│   └── routes.py              # Upload, list, delete, search endpoints
│
└── services/                  # Business logic
    ├── encryption.py          # Fernet encrypt/decrypt for API keys
    └── agent_runner.py        # LangGraph agent orchestration
```

---

## Frontend Structure

```
desk-app/
├── electron/                  # Electron main process
│   ├── main.ts                # Window, tray, timer, IPC, system control (467 lines)
│   └── preload.ts             # Context bridge (65 lines)
│
├── public/
│   ├── icon.png               # App icon
│   ├── nature_bg.png          # Background image
│   ├── preview.gif            # App preview for README
│   └── tone/1sec-tone.wav     # Break countdown sound
│
├── src/                       # React app
│   ├── main.tsx               # Entry (Redux + Toast providers)
│   ├── App.tsx                # Root component (timer, overlays)
│   ├── index.css              # Tailwind theme + animations
│   │
│   ├── components/            # UI overlays
│   │   ├── ChatOverlay.tsx    # AI chat with sidebar + semantic search
│   │   ├── BreakView.tsx      # Full-screen break view
│   │   ├── KnowledgeBase.tsx  # Personal document KB panel
│   │   ├── SettingsOverlay.tsx
│   │   ├── ProfileOverlay.tsx
│   │   ├── MusicOverlay.tsx
│   │   ├── InsightsOverlay.tsx
│   │   ├── LoginModal.tsx
│   │   └── ...
│   │
│   ├── store/                 # Redux state management
│   │   ├── authSlice.ts       # Auth + localStorage persistence
│   │   ├── chatSlice.ts       # Chat sessions + search
│   │   ├── settingsSlice.ts   # Break settings
│   │   ├── activitySlice.ts   # Activity tracking
│   │   ├── tipSlice.ts        # Break tips
│   │   └── kbSlice.ts         # Knowledge base state
│   │
│   └── types/                 # TypeScript declarations
│
├── package.json               # Dependencies + scripts
├── vite.config.ts             # Vite config
└── tsconfig.electron.json     # Electron TS config
```

### Electron Three-Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐         ┌──────────────────────┐  │
│  │  Main Process    │◄───────►│  Preload Script      │  │
│  │  (Node.js)       │   IPC   │  (Context Bridge)    │  │
│  │                  │         └──────────────────────┘  │
│  │  • Window mgmt   │                    ▲              │
│  │  • System tray   │                    │ IPC          │
│  │  • File system   │                    │              │
│  │  • Auto-launch   │                    │              │
│  │  • Timer logic   │                    │              │
│  └──────────────────┘                    │              │
│                                          │              │
│                               ┌──────────────────────┐  │
│                               │  Renderer Process    │  │
│                               │  (React + Chromium)  │  │
│                               │                      │  │
│                               │  • UI components     │  │
│                               │  • Timer display     │  │
│                               │  • Settings panel    │  │
│                               │  • Break overlay     │  │
│                               └──────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- **Main Process** (`electron/main.ts`): Node.js, manages windows, tray, timer, system control
- **Renderer Process** (`src/App.tsx`): React in Chromium, displays UI, no direct Node.js access
- **Preload Script** (`electron/preload.ts`): Secure bridge using `contextBridge` for IPC

### IPC Communication Flow

```
React Component → window.electronAPI.sendPauseTimer()
    ↓
preload.ts (contextBridge) → ipcRenderer.send('pause-timer')
    ↓
Main Process (main.ts) → ipcMain.on('pause-timer', handler)
    ↓
Timer paused → mainWindow.webContents.send('timer-update', time)
    ↓
preload.ts → ipcRenderer.on('timer-update', callback)
    ↓
React Component updates UI
```

Timer state lives in the **main process** (not React), so it survives UI crashes.

---

## Agent Architecture

```
User message
    ↓
[agent_node] → LLM (OpenRouter) + bound tools
    ↓                          ↓
  No tool calls           Tool calls
    ↓                          ↓
   END                    [tools_node] → execute tool
                               ↓
                          [agent_node] → loop again (max 10 iterations)
```

### 5 Agent Tools

| Tool | Purpose | Auto-Execute? |
|------|---------|---------------|
| `check_system_settings` | Analyze brightness/volume against health guidelines | When user says "fix", "optimize", "apply" |
| `get_user_activity` | Query user's break history from DB | No (always show) |
| `get_user_break_settings` | Get user's configured break preferences | No (always show) |
| `get_break_tip` | Return wellness tip from curated library | When user says "set up breaks" |
| `recommend_music` | Map mood → YouTube music search | When user says "play music" |
| `kb_search` | Search user's uploaded documents (PDF/TXT/MD) | When user asks about their docs |

### Tool Execution Modes

Each tool supports two modes:
- **Auto-execute** (`auto_apply=true`): Applies changes immediately, tells user what was done
- **Show options** (`auto_apply=false`): Presents recommendations with Execute/Reject buttons

---

## RAG Pipeline

### Ingestion (Storing Conversations)

```
Every chat response
    ↓
Combine: "User: {message}\nAI: {response}"
    ↓
Chunk (if > 300 words): split into overlapping chunks
    ↓
Embed each chunk (all-MiniLM-L6-v2, 384 dims)
    ↓
Store in ChromaDB (per-user collection with metadata)
```

Each chunk gets metadata linking it to its parent:
- `user_id`, `session_id`, `timestamp`
- `chunk_index`, `total_chunks`, `parent_id`
- Document ID: `{session_id}_{timestamp}_c{chunk_index}`

Short exchanges (< 300 words) stored as a single document. Long responses split into overlapping chunks.

### Retrieval (Semantic Search)

```
POST /chat/history/search
    ↓
Embed query (same model)
    ↓
Cosine similarity → top-k results
    ↓
Reconstruct full documents from chunks (sort by chunk_index, combine)
    ↓
Return ranked conversations with relevance scores (0-1)
```

### Chunking Strategy

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `CHUNK_SIZE` | 300 words | Max words per chunk (safe under 512 token limit) |
| `CHUNK_OVERLAP` | 50 words | Words repeated between chunks to preserve context |

**Example:**
```
Full exchange (800 words):
  Chunk 0: words 1-300
  Chunk 1: words 250-550  (50 word overlap)
  Chunk 2: words 500-800  (50 word overlap)
```

### RAG Config

| Setting | Value |
|---------|-------|
| ChromaDB path | `backend/rag/chroma_db/` |
| Embedding device | CPU |
| Normalization | Enabled (cosine similarity) |
| Telemetry | Disabled |

---

## Knowledge Base (Personal Document RAG)

Users can upload PDF, TXT, and MD files to their personal knowledge base. The agent can then search these documents when answering questions.

### Upload Flow

```
User → POST /kb/upload (PDF/TXT/MD file)
  ↓
Extract text (PyMuPDF for PDF, plain read for TXT/MD)
  ↓
Strip markdown syntax (MD files only)
  ↓
Chunk (300 words, 50 overlap — same as chat RAG)
  ↓
Embed (all-MiniLM-L6-v2, same model)
  ↓
Store in ChromaDB: kb_{user_id} collection
  ↓
Return: doc_id, filename, chunk_count, char_count
```

### Search Flow

```
Agent calls kb_search(query) → tool embeds query
  ↓
Cosine similarity in kb_{user_id}
  ↓
Group results by doc_id (combine chunks from same file)
  ↓
Return: filename, content excerpt, relevance score
```

### KB API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/kb/upload` | Upload PDF/TXT/MD → extract → chunk → embed → store |
| GET | `/kb/documents` | List user's uploaded documents |
| DELETE | `/kb/documents/{doc_id}` | Delete document + all its chunks |
| POST | `/kb/search` | Semantic search across user's knowledge base |

### KB Storage

- ChromaDB collection: `kb_{user_id}` (isolated per user)
- Each chunk metadata: `doc_id`, `filename`, `file_type`, `chunk_index`, `total_chunks`, `page_count`
- No file storage — only extracted text is kept in vectors

### KB Frontend

- **KnowledgeBase.tsx** component embedded in ChatOverlay
- Toggle via book icon in chat header
- Shows uploaded files with delete buttons
- File upload via drag-and-drop or click
- Supported: PDF, TXT, MD

---

## Data Flow

### Chat Message

```
1. Client → POST /chat/send { message, session_id, brightness, volume }
2. Backend verifies JWT, loads user + AI provider config
3. Decrypts API key (Fernet, device-specific key)
4. Builds system prompt with user context + system metrics
5. Creates LangGraph agent with 5 tools
6. Agent loops: LLM → tool calls → LLM → ... → final text
7. Extracts token usage from LLM response metadata
8. Saves conversation to MongoDB chatbot-history
9. Embeds conversation → stores in ChromaDB (with chunking)
10. Returns { response, session_id, recommendations, tools_used, token_usage }
```

### Device Auth

```
1. App reads machine GUID from OS (Windows Registry / macOS UUID / Linux dbus)
2. SHA-256 hash → device_id
3. POST /auth/device { device_id }
4. Backend creates user if not exists, returns JWT
5. JWT stored in Redux + localStorage
```

---

## API Reference

Backend: `http://localhost:8000` | Docs: `http://localhost:8000/docs`

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/device` | Login/register with device ID |
| GET | `/auth/me` | Get current user profile |
| PUT | `/auth/profile` | Update profile + AI provider config |
| GET | `/auth/ai-providers/{key}` | Get decrypted AI provider config |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/chat/send` | Send message to AI agent |
| GET | `/chat/history/` | List chat sessions |
| GET | `/chat/history/{id}` | Get session messages |
| POST | `/chat/history/search` | Semantic search (RAG) |
| DELETE | `/chat/history/{id}` | Delete a session |
| DELETE | `/chat/history/clear` | Clear all history |

### Settings & Activity

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings/user` | Get break settings |
| PUT | `/settings/user` | Update break settings |
| POST | `/activity/session` | Save completed session |
| GET | `/activity/history` | Get activity history |
| GET | `/activity/today` | Get today's stats |

### Agent & Music

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/recommendations` | Get rule-based recommendations |
| POST | `/agent/execute/{type}` | Execute a recommendation |
| POST | `/tips/recommendation` | Get AI wellness tip |
| GET | `/music/search?q=...` | Search YouTube music |
| GET | `/music/mood/{mood}` | Music by mood |
| GET | `/music/ambient/{mood}` | Ambient video by mood |

---

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| LLM Provider | OpenRouter (BYOK) | Users own their keys, access to 100+ models |
| Agent Framework | LangGraph | Stateful multi-tool agent with conditional loops |
| Database | MongoDB + JSON fallback | Cloud primary, never crashes without DB connection |
| Embeddings | all-MiniLM-L6-v2 | Free, runs locally on CPU, no API key needed |
| Vector Store | ChromaDB | Zero config, embedded, persistent local storage |
| Desktop | Electron | Cross-platform, native system access (brightness, volume) |
| Auth | Device-based (machine GUID) | No passwords, no email — just works on the machine |
| Timer | Electron main process | Survives React crashes, always counts down |
