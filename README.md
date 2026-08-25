<div align="center">

# AntiBurnout.ai

AI-powered desktop wellness assistant that prevents digital burnout during long screen sessions.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-blue.svg)](#)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](#)

</div>

<p align="center">
  <img src="desk-app/public/preview.gif" width="80%" alt="AntiBurnout Preview" />
</p>

---

## Quick Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- MongoDB Atlas (optional — falls back to local JSON)

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate              # Windows
# source venv/bin/activate         # macOS/Linux
pip install -r requirements.txt
copy .env.example .env             # Edit with your values
uvicorn main:app --host 0.0.0.0 --port 8010   # http://localhost:8010
```

One-liner (PowerShell — activates venv and starts backend on 8010):

```powershell
cd backend; & .\venv\Scripts\Activate.ps1; uvicorn main:app --host 0.0.0.0 --port 8010 --reload
```

### Frontend

```bash
cd desk-app
npm install
copy .env.example .env
npm run dev                        # Vite dev server (browser)
npm run electron:dev               # Electron desktop app
```

On first launch, configure your **OpenRouter API key** in Profile Settings.

---

## Environment Variables

### Backend (`backend/.env`)

```env
SECRET_KEY=your-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
MONGODB_URI=mongodb+srv://...       # optional
MONGODB_DB_NAME=antiburnout         # optional
YTKEY=AIza...                       # optional (for music search)
```

### Frontend (`desk-app/.env`)

```env
VITE_API_URL=http://localhost:8010
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (browser) |
| `npm run electron:dev` | Electron desktop app |
| `npm run electron:dev:watch` | Electron with hot-reload |
| `npm run build` | Production build |
| `npm run electron:build:win` | Package as .exe |
| `npm run electron:build:mac` | Package as .dmg |
| `npm run electron:build:linux` | Package as AppImage |

---

## Documentation

- **[Architecture & Features](docs/DETAIL.md)** — full system design, all features, tech stack, API reference

---

## License

MIT
