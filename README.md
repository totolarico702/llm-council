# LLM Council

![llmcouncil](header.jpg)

> Enterprise intranet multi-LLM orchestrator — 3-stage deliberation, organizational RAG, configurable DAG pipelines.

---

## Concept

LLM Council replaces the single-LLM chatbot with a **council of models** that deliberate together before answering:

1. **Stage 1 — First opinions**: your question is sent simultaneously to multiple LLMs via OpenRouter. Each response is displayed in a dedicated tab.
2. **Stage 2 — Cross-review**: each LLM anonymously evaluates the others' responses and ranks them by relevance and quality. Anonymization prevents favoritism bias between models.
3. **Stage 3 — Final synthesis**: the Chairman LLM (configurable) compiles all responses and rankings into a single consolidated answer.

All wrapped in a local web interface that looks like an enterprise ChatGPT, with user management, access control, and organizational memory (RAG).

---

## Quick Deploy

An automated deployment script is provided for Windows and Linux/Mac. It installs all dependencies, configures the environment, and verifies everything works before the first launch.

### Windows

```bat
deploy.bat
```

### Linux / Mac

```bash
chmod +x deploy.sh
./deploy.sh
```

The script automatically:
- Checks prerequisites (Python, uv, Node.js)
- Creates `.env` from `.env.example`
- Installs Python dependencies (`uv sync`)
- Installs Node.js dependencies (`npm install`)
- Detects and configures Ollama if installed
- Verifies the backend (import + route count)
- Runs the test suite

Once deployed, start the application with:

```bat
# Windows
start.bat

# Linux/Mac
./start.sh
```

Then open [http://localhost:5173](http://localhost:5173)

**Default credentials:** `admin` / `admin`
⚠️ You will be forced to change the password on first login.

---

## Prerequisites

| Tool | Minimum version | Link |
|------|----------------|------|
| Python | 3.10+ | [python.org](https://www.python.org/downloads/) |
| uv | latest | [astral.sh/uv](https://docs.astral.sh/uv/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Ollama | any | [ollama.ai](https://ollama.ai/) *(optional — local models)* |

---

## Configuration

### OpenRouter API Key

Create an account at [openrouter.ai](https://openrouter.ai/) and set the key in `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-...
JWT_SECRET=your-long-random-secret
PRODUCTION=0
FS_BROWSER_ROOT=C:\Users\YourName
RAG_UPLOAD_MAX_MB=100
RAG_AUDIT_RETENTION_DAYS=90
```

### Council Models

Edit `backend/config.py`:

```python
COUNCIL_MODELS = [
    "mistralai/mistral-medium-3",
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4o",
    "google/gemini-2.0-flash-001",
]

CHAIRMAN_MODEL = "mistralai/mistral-medium-3"
```

---

## V2 Features

### Multi-LLM Deliberation
- Stage 1 / 2 / 3 with model anonymization in Stage 2
- Configurable Chairman per pipeline
- Automatic fallback if a model is unavailable
- Real-time DAG execution trace
- **Caffeine Mode**: mandatory human validation before the final response is displayed

### DAG Pipelines
- Visual editor in **3 columns**: AI assistant | canvas | node config
- **Grammar .cog v1.0**: reproducible pipeline export/import in JSON
- Available nodes: LLM, RAG Search, Fact-check, Web Search, MCP, Condition, Merge, loops
- **Pipeline assistant**: create or modify a pipeline in natural language
- TinyDB persistence with auto-save every 30s and `● Unsaved` indicator
- **Cost simulation**: live 💰 badge in the toolbar + per-node detail popup
- Cloud (OpenRouter) / local (Ollama) toggle per node
- Global timeout 300s, per-node timeout 30s

### LLM Quality Scoring
- **Automatic score** after each Chairman response (LLM judge: mistral-medium-3)
- **Manual feedback** 👍 👎 ⭐ below each Chairman response
- AdminPanel > Model status widget: relevance / accuracy / format / global table
- Filter by period: 7d / 30d / 90d

### RAG — Organizational Memory
- Document indexing (PDF, DOCX, TXT, MD) via LanceDB
- Folder tree with ACL permissions inherited by department
- 90-day audit log (creations, deletions, uploads, ACL changes)
- Automatic injection of @mentioned documents into the prompt
- RAAD panel (right sidebar) with full-text search and drag & drop
- Integrated file browser for direct upload to the RAG

### User Management & Permissions
- JWT authentication (httpOnly cookie, 7-day refresh token)
- Full conversation isolation per user
- Granular permissions: `rag_read`, `rag_write`, `admin`
- Login rate limiting (5 requests/min per IP)
- `must_change_password` on first admin login

### Local Models
- Ollama integration (mistral:latest by default)
- Ollama model manager in AdminPanel
- Cloud/local toggle per node in the PipelineEditor

### Interface
- **Centralized CSS** with branding variables (`frontend/src/styles/`) — dark theme
- **Centralized API client** (`api/client.js` + `api/routes.js`)
- Comex dashboard (shareable link without authentication)
- Real-time model status panel (🟢🟡🔴)
- Multilingual support (French forced by default)

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | FastAPI (Python 3.10+), uv |
| Frontend | React 18 + Vite |
| Database | TinyDB (metadata + scores + pipelines) + LanceDB (RAG vectors) |
| LLM routing | OpenRouter API |
| Local LLM | Ollama |
| Auth | JWT httpOnly cookie + bcrypt |
| Rate limiting | slowapi |
| Logging | structlog |
| Tests | Pytest + pytest-asyncio |

---

## Tests

```bash
uv run pytest backend/tests/ -v --cov=backend --cov-report=term-missing
```

---

## Project Structure

```
llm-council/
├── deploy.bat           # Windows deployment script
├── deploy.sh            # Linux/Mac deployment script
├── start.bat            # Windows start script
├── start.sh             # Linux/Mac start script
├── backend/
│   ├── main.py          # FastAPI app, routes /api/v1/
│   ├── db.py            # Auth, users, TinyDB
│   ├── council.py       # 3-stage deliberation logic
│   ├── dag_engine.py    # DAG pipeline executor
│   ├── rag_store.py     # LanceDB indexing
│   ├── rag_folders.py   # Folder tree + ACL
│   ├── rag_audit.py     # Audit log
│   ├── fs_browser.py    # Filesystem browser
│   ├── errors.py        # Uniform error format
│   ├── logging_config.py
│   └── tests/           # Pytest — auth, users, dag, rag
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       └── components/
│           ├── ChatInterface.jsx
│           ├── PipelineEditor.jsx
│           ├── RAADPanel.jsx
│           └── AdminPanel/
│               └── RAGTab.jsx
├── data/                # Git-ignored
│   ├── db.json          # TinyDB
│   └── lancedb/         # Vector index
├── CLAUDE.md            # Shared agent memory
└── .env.example
```

---

## Roadmap

### V1 ✅ Done
- 3-stage deliberation, basic interface, RAG, user management

### V2 ✅ Done
- Cognitive grammar `.cog` — reproducible pipeline format
- Caffeine Mode — human validation post-Chairman
- LLM quality scoring (auto + manual)
- Pipeline cost simulation
- PipelineEditor 3-column + AI assistant + persistence
- Centralized CSS + branding variables
- JWT httpOnly cookie + refresh token
- Pytest test suite

### V3 — in progress
- Multi-agent orchestration with Claude Code
- Open-core / publication
- CI/CD GitHub Actions
- Docker Compose

---

## License

MIT — see [LICENSE](LICENSE)
