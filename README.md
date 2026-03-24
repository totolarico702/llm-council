# LLM Council

![llmcouncil](header.jpg)

> Orchestrateur multi-LLM intranet entreprise — délibération à 3 stages, RAG organisationnel, pipelines DAG configurables.

---

## Concept

LLM Council remplace le chatbot mono-LLM par un **conseil de modèles** qui délibèrent ensemble avant de vous répondre :

1. **Stage 1 — Premières opinions** : votre question est envoyée simultanément à plusieurs LLMs via OpenRouter. Chaque réponse est affichée dans un onglet dédié.
2. **Stage 2 — Revue croisée** : chaque LLM évalue anonymement les réponses des autres et les classe par pertinence et qualité. L'anonymisation évite les biais de favoritisme entre modèles.
3. **Stage 3 — Synthèse finale** : le Chairman LLM (configurable) compile toutes les réponses et les classements en une réponse finale consolidée.

Le tout dans une interface web locale qui ressemble à un ChatGPT d'entreprise, avec gestion des utilisateurs, des droits, et de la mémoire organisationnelle (RAG).

---

## Fonctionnalités V1

### Délibération multi-LLM
- Stage 1 / 2 / 3 avec anonymisation des modèles en Stage 2
- Chairman configurable par pipeline
- Fallback automatique si un modèle est indisponible
- Trace d'exécution DAG en temps réel

### Pipelines DAG
- Éditeur visuel de pipelines (PipelineEditor)
- Nœuds configurables : LLM, RAG Search, outils
- Toggle cloud (OpenRouter) / local (Ollama) par nœud
- Timeout global 300s, timeout par nœud 30s

### RAG — Mémoire organisationnelle
- Indexation de documents (PDF, DOCX, TXT, MD) via LanceDB
- Arborescence de dossiers avec permissions ACL héritées par service
- Audit log 90 jours (créations, suppressions, uploads, modifications ACL)
- Injection automatique des documents @mentionnés dans le prompt
- Panel RAAD (sidebar droite) avec recherche full-text et drag & drop

### Gestion utilisateurs & droits
- Authentification JWT (httpOnly cookie, refresh token 7 jours)
- Isolation complète des conversations par utilisateur
- Permissions granulaires : `rag_read`, `rag_write`, `admin`
- Rate limiting sur le login (5 requêtes/min par IP)

### Modèles locaux
- Intégration Ollama (mistral:latest par défaut)
- Gestionnaire de modèles Ollama dans l'AdminPanel
- Toggle cloud/local par nœud dans le PipelineEditor

### Interface
- Dashboard Comex (lien partageable sans authentification)
- Panel état modèles temps réel (🟢🟡🔴)
- Explorateur PC intégré pour upload vers le RAG
- Support multilingue (français forcé par défaut)

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend | FastAPI (Python 3.10+), uv |
| Frontend | React 18 + Vite |
| Base de données | TinyDB (métadonnées) + LanceDB (vecteurs RAG) |
| LLM routing | OpenRouter API |
| LLM local | Ollama |
| Auth | JWT httpOnly cookie + bcrypt |
| Rate limiting | slowapi |
| Logging | structlog |
| Tests | Pytest + pytest-asyncio |

---

## Installation

### Prérequis

- Python 3.10+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) pour la gestion des dépendances Python
- [Ollama](https://ollama.ai/) (optionnel, pour les modèles locaux)

### 1. Cloner le projet

```bash
git clone https://github.com/totolarico702/llm-council.git
cd llm-council
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
```

Éditer `.env` :

```env
OPENROUTER_API_KEY=sk-or-v1-...
JWT_SECRET=votre-secret-aleatoire-long
PRODUCTION=0
FS_BROWSER_ROOT=C:\Users\VotreNom
RAG_UPLOAD_MAX_MB=100
RAG_AUDIT_RETENTION_DAYS=90
```

### 3. Installer les dépendances

**Backend :**
```bash
uv sync
uv add slowapi structlog
```

**Frontend :**
```bash
cd frontend
npm install
cd ..
```

### 4. Lancer l'application

```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

Ou manuellement :

```bash
# Terminal 1 — Backend (port 8001)
uv run python -m backend.main

# Terminal 2 — Frontend (port 5173)
cd frontend && npm run dev
```

Ouvrir [http://localhost:5173](http://localhost:5173)

**Identifiants par défaut :** `admin` / `admin`
⚠️ Vous serez forcé de changer le mot de passe au premier login.

---

## Configuration des modèles

Éditer `backend/config.py` :

```python
# Modèles du conseil
COUNCIL_MODELS = [
    "mistralai/mistral-medium-3",      # Modèle par défaut
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4o",
    "google/gemini-2.0-flash-001",
]

# Chairman (synthèse finale)
CHAIRMAN_MODEL = "mistralai/mistral-medium-3"

# Fallback chain (cloud)
FALLBACK_MODELS = [
    "mistralai/mistral-medium-3",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-4o-mini",
]
```

---

## Tests

```bash
uv run pytest backend/tests/ -v --cov=backend --cov-report=term-missing
```

---

## Structure du projet

```
llm-council/
├── backend/
│   ├── main.py              # FastAPI app, routes /api/v1/
│   ├── db.py                # Auth, users, TinyDB
│   ├── council.py           # Logique délibération 3 stages
│   ├── dag_engine.py        # Exécuteur de pipelines DAG
│   ├── rag_store.py         # Indexation LanceDB
│   ├── rag_folders.py       # Arborescence dossiers + ACL
│   ├── rag_audit.py         # Audit log
│   ├── fs_browser.py        # Explorateur filesystem
│   ├── errors.py            # Format d'erreur uniforme
│   ├── logging_config.py    # structlog
│   └── tests/               # Pytest — auth, users, dag, rag
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── api.js           # Client HTTP, cookies
│       └── components/
│           ├── ChatInterface.jsx
│           ├── PipelineEditor.jsx
│           ├── RAADPanel.jsx
│           ├── AdminPanel.jsx
│           └── AdminPanel/
│               └── RAGTab.jsx   # Gestionnaire RAG
├── data/                    # Ignoré par git
│   ├── db.json              # TinyDB
│   └── lancedb/             # Index vectoriel
├── docs/briefs/             # Briefs de développement
├── CLAUDE.md                # Mémoire partagée agents
├── .env.example
└── start.bat / start.sh
```

---

## Roadmap

### V2 (en cours)
- Grammaire cognitive `.cog` — format de pipeline reproductible
- Mode Caféine — validation humaine post-Chairman
- Scoring qualité LLM par réponse
- Simulation de coûts par pipeline

### V3
- Multi-agents avec orchestration Claude Code
- Open-core / publication
- CI/CD GitHub Actions
- Docker Compose

---

## Licence

Projet privé — usage intranet entreprise.
