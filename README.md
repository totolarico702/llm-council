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

## Déploiement rapide

Un script de déploiement automatique est fourni pour Windows et Linux/Mac. Il installe toutes les dépendances, configure l'environnement et vérifie que tout fonctionne avant le premier démarrage.

### Windows

```bat
deploy.bat
```

### Linux / Mac

```bash
chmod +x deploy.sh
./deploy.sh
```

Le script effectue automatiquement :
- Vérification des prérequis (Python, uv, Node.js)
- Création du fichier `.env` depuis `.env.example`
- Installation des dépendances Python (`uv sync`)
- Installation des dépendances Node.js (`npm install`)
- Détection et configuration d'Ollama si installé
- Vérification du backend (chargement + comptage des routes)
- Exécution de la suite de tests

Une fois le déploiement terminé, lancer l'application avec :

```bat
# Windows
start.bat

# Linux/Mac
./start.sh
```

Puis ouvrir [http://localhost:5173](http://localhost:5173)

**Identifiants par défaut :** `admin` / `admin`
⚠️ Vous serez forcé de changer le mot de passe au premier login.

---

## Prérequis

| Outil | Version minimale | Lien |
|-------|-----------------|------|
| Python | 3.10+ | [python.org](https://www.python.org/downloads/) |
| uv | latest | [astral.sh/uv](https://docs.astral.sh/uv/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Ollama | any | [ollama.ai](https://ollama.ai/) *(optionnel — modèles locaux)* |

---

## Configuration

### Clé API OpenRouter

Créer un compte sur [openrouter.ai](https://openrouter.ai/) et renseigner la clé dans `.env` :

```env
OPENROUTER_API_KEY=sk-or-v1-...
JWT_SECRET=votre-secret-aleatoire-long
PRODUCTION=0
FS_BROWSER_ROOT=C:\Users\VotreNom
RAG_UPLOAD_MAX_MB=100
RAG_AUDIT_RETENTION_DAYS=90
```

### Modèles du conseil

Éditer `backend/config.py` :

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

## Fonctionnalités V2

### Délibération multi-LLM
- Stage 1 / 2 / 3 avec anonymisation des modèles en Stage 2
- Chairman configurable par pipeline
- Fallback automatique si un modèle est indisponible
- Trace d'exécution DAG en temps réel
- **Mode Caféine** : validation humaine obligatoire avant affichage de la réponse finale

### Pipelines DAG
- Éditeur visuel en **3 colonnes** : assistant IA | canvas | config nœud
- **Grammaire .cog v1.0** : export/import de pipelines en JSON reproductible
- Nœuds disponibles : LLM, RAG Search, Fact-check, Web Search, MCP, Condition, Merge, boucles
- **Assistant pipeline** : créer ou modifier un pipeline en langage naturel
- Persistance TinyDB avec auto-save toutes les 30s et indicateur `● Non sauvegardé`
- **Simulation de coûts** : badge 💰 en temps réel dans la toolbar + popup détail par nœud
- Toggle cloud (OpenRouter) / local (Ollama) par nœud
- Timeout global 300s, timeout par nœud 30s

### Scoring qualité LLM
- **Score automatique** après chaque réponse Chairman (LLM juge : mistral-medium-3)
- **Feedback manuel** 👍 👎 ⭐ sous chaque réponse Chairman
- Widget AdminPanel > État modèles : tableau pertinence / précision / format / global
- Filtre par période 7j / 30j / 90j

### RAG — Mémoire organisationnelle
- Indexation de documents (PDF, DOCX, TXT, MD) via LanceDB
- Arborescence de dossiers avec permissions ACL héritées par service
- Audit log 90 jours (créations, suppressions, uploads, modifications ACL)
- Injection automatique des documents @mentionnés dans le prompt
- Panel RAAD (sidebar droite) avec recherche full-text et drag & drop
- Explorateur PC intégré pour upload direct vers le RAG

### Gestion utilisateurs & droits
- Authentification JWT (httpOnly cookie, refresh token 7 jours)
- Isolation complète des conversations par utilisateur
- Permissions granulaires : `rag_read`, `rag_write`, `admin`
- Rate limiting sur le login (5 requêtes/min par IP)
- `must_change_password` à la première connexion admin

### Modèles locaux
- Intégration Ollama (mistral:latest par défaut)
- Gestionnaire de modèles Ollama dans l'AdminPanel
- Toggle cloud/local par nœud dans le PipelineEditor

### Interface
- **CSS centralisé** avec variables de branding (`frontend/src/styles/`) — thème dark
- **Client API centralisé** (`api/client.js` + `api/routes.js`)
- Dashboard Comex (lien partageable sans authentification)
- Panel état modèles temps réel (🟢🟡🔴)
- Support multilingue (français forcé par défaut)

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend | FastAPI (Python 3.10+), uv |
| Frontend | React 18 + Vite |
| Base de données | TinyDB (métadonnées + scores + pipelines) + LanceDB (vecteurs RAG) |
| LLM routing | OpenRouter API |
| LLM local | Ollama |
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

## Structure du projet

```
llm-council/
├── deploy.bat           # Script de déploiement Windows
├── deploy.sh            # Script de déploiement Linux/Mac
├── start.bat            # Démarrage Windows
├── start.sh             # Démarrage Linux/Mac
├── backend/
│   ├── main.py          # FastAPI app, routes /api/v1/
│   ├── db.py            # Auth, users, TinyDB
│   ├── council.py       # Logique délibération 3 stages
│   ├── dag_engine.py    # Exécuteur de pipelines DAG
│   ├── rag_store.py     # Indexation LanceDB
│   ├── rag_folders.py   # Arborescence dossiers + ACL
│   ├── rag_audit.py     # Audit log
│   ├── fs_browser.py    # Explorateur filesystem
│   ├── errors.py        # Format d'erreur uniforme
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
├── data/                # Ignoré par git
│   ├── db.json          # TinyDB
│   └── lancedb/         # Index vectoriel
├── docs/briefs/         # Briefs de développement
├── CLAUDE.md            # Mémoire partagée agents
└── .env.example
```

---

## Roadmap

### V1 ✅ Terminé
- Délibération 3 étapes, interface basique, RAG, gestion utilisateurs

### V2 ✅ Terminé
- Grammaire cognitive `.cog` — format de pipeline reproductible
- Mode Caféine — validation humaine post-Chairman
- Scoring qualité LLM (auto + manuel)
- Simulation de coûts par pipeline
- PipelineEditor 3 colonnes + assistant IA + persistance
- CSS centralisé + variables branding
- JWT httpOnly cookie + refresh token
- Tests Pytest

### V3 — en cours
- Multi-agents avec orchestration Claude Code
- Open-core / publication
- CI/CD GitHub Actions
- Docker Compose

---

## Licence

Projet privé — usage intranet entreprise.
