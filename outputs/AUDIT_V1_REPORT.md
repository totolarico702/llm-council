# AUDIT V1 — LLM Council
*Audit statique du code source — 23 mars 2026*

---

## Bugs bloquants (priorité 1)

### 1. Double implémentation authentification (auth.py vs db.py)
- Deux JWT/bcrypt coexistent avec des chemins de stockage différents (`data/users.json` vs `data/db.json`)
- Confusion sur laquelle est active ; migration legacy non garantie
- **Fix :** Supprimer `auth.py`, unifier tout sur `db.py`

### 2. JWT secret par défaut non forcé
- Valeur par défaut : `"llm-council-dev-secret-CHANGE-IN-PROD"`
- Aucun check qui lève une exception si ce secret est en production
- **Fix :** `if os.getenv("PRODUCTION") and JWT_SECRET == default: raise RuntimeError(...)`

### 3. Admin par défaut admin/admin sans forçage de changement
- L'utilisateur admin est créé avec mot de passe `admin` au premier démarrage
- Aucun mécanisme ne force le changement de mot de passe au premier login
- **Fix :** Flag `must_change_password`, redirect obligatoire

### 4. Zéro tests unitaires ou d'intégration
- 0 fichier `test_*.py` dans tout le backend
- 0 fichier Vitest/Playwright dans le frontend
- Régressions sur DAG engine, auth, RAG, parsing non détectables
- **Fix :** Pytest backend 80%+ coverage avant V2 ; Playwright E2E avant V3

---

## Bugs dégradés (priorité 2)

### 5. Absence de rate limiting sur /api/auth/login
- Brute force possible sans aucune limite
- **Fix :** `slowapi` ou middleware IP-based avec lockout progressif

### 6. JWT token en localStorage (vulnérable XSS)
- Token accessible à tout script JS injecté
- **Fix :** Migrer vers `httpOnly` cookie (set côté serveur FastAPI)

### 7. Pas de protection CSRF
- Requêtes POST sans token CSRF, vulnérable si l'utilisateur visite un site malveillant
- **Fix :** `fastapi-csrf-protect` middleware

### 8. Upload fichiers sans validation de taille ni timeout
- Pas de limite de taille fichier (DoS possible avec PDF de 2 Go)
- Extraction PDF/DOCX peut bloquer l'event loop
- **Fix :** Limite 100 Mo, extraction dans un thread séparé (`asyncio.to_thread`)

### 9. Race condition sur usage_logs.jsonl
- `usage_logger.py` écrit en append-only sans file lock
- Si 2 requêtes simultanées, corruption possible du JSONL
- **Fix :** `asyncio.Lock` ou rotation vers TinyDB/SQLite

### 10. Parsing Stage 2 silencieusement vide
- Si un modèle ne respecte pas le format `FINAL RANKING:`, `parse_ranking_from_text()` retourne `[]` sans erreur visible
- Stage 2 continue mais aggregate rankings sont faux
- **Fix :** Logger un warning explicite + indiquer dans la réponse que le parsing a échoué

### 11. Score threshold non utilisé dans RAG search
- Le paramètre `score_threshold` est présent dans la signature de `search()` mais ignoré dans la requête LanceDB
- Les résultats faiblement pertinents sont retournés au LLM
- **Fix :** Filtrer `results = [r for r in results if r.score >= score_threshold]`

### 12. Pas de timeout global DAG
- Timeout 30s par nœud, mais pas de timeout global pour l'exécution complète
- Un pipeline de 10 nœuds peut bloquer 5 minutes
- **Fix :** `asyncio.wait_for(execute_dag(...), timeout=300)`

---

## Bugs cosmétiques (priorité 3)

### 13. chromadb-client dans pyproject.toml mais jamais importé
- Dépendance inutile (LanceDB remplace l'ancienne intégration Qdrant)
- **Fix :** Supprimer de `pyproject.toml`

### 14. main_patch.py à la racine backend
- Fichier patch dont le statut est inconnu (obsolète ?)
- **Fix :** Supprimer ou documenter son rôle

### 15. Pas d'Error Boundary React
- Un crash JS non rattrapé rend la page entièrement blanche
- **Fix :** Wrapper `<App />` dans un `<ErrorBoundary fallback={<ErrorPage />}>`

### 16. Mix français/anglais dans les commentaires code
- Comments code mélangent FR et EN selon le module
- **Fix :** Standardiser en anglais

### 17. BRIEF_*.md en racine (7 fichiers)
- Encombrent la racine du projet
- **Fix :** Déplacer dans `docs/briefs/`

---

## Fonctionnalités incomplètes

| Fonctionnalité | État | Détail |
|---|---|---|
| Refresh token JWT | Absent | Token 8h fixe, expiration non gérée côté frontend |
| Rate limiting | Absent | Aucune route protégée |
| Logging structuré | Absent | Print statements seulement |
| Versioning API `/api/v1/` | Absent | Routes en `/api/` direct |
| Mode Caféine | Absent | Non trouvé dans le code |
| Format .cog | Absent | Non défini, ni parsé, ni documenté |
| Score threshold RAG | Partiel | Paramètre présent, filtrage non appliqué |
| Réindexation planifiée RAG | Absent | Drift modèle embedding non géré |
| CI/CD | Absent | Pas de Github Actions, pas de Docker |
| Tests | Absent | 0% couverture |
| Export conversations | Absent | Mentionné comme future feature |
| Analytics modèles | Absent | Mentionné comme future feature |

---

## Erreurs console JS récurrentes

> *Audit statique uniquement — sans exécution navigateur. Risques identifiés par analyse du code React.*

| # | Source probable | Type | Fréquence | Impact |
|---|---|---|---|---|
| 1 | `App.jsx` — `useEffect` sans dépendances exhaustives | ESLint warning / stale closure | Récurrent | Données périmées affichées |
| 2 | Absence d'Error Boundary | Uncaught TypeError si API crash | One-shot | Bloquant (page blanche) |
| 3 | SSE `EventSource` — pas de reconnection automatique | Connection lost silencieuse | One-shot | Réponse LLM perdue |
| 4 | `localStorage` — quota exceeded sur vieux navigateurs | QuotaExceededError | Rare | Auth impossible |
| 5 | `react-arborist` + `react-markdown` — versions React 19 | Peer deps warnings | Au démarrage | Cosmétique |

---

## Erreurs backend récurrentes

> *Risques identifiés par analyse statique du code FastAPI.*

| # | Route | Code HTTP probable | Fréquence | Impact |
|---|---|---|---|---|
| 1 | `POST /api/conversations/{id}/message/stream` | 500 si OpenRouter timeout | Occasionnel | Bloquant |
| 2 | `POST /api/rag/upload` (gros fichier) | 413 / 500 (timeout extraction) | Avec gros docs | Bloquant |
| 3 | Toute route admin si `data/db.json` corrompu | 500 | Rare | Critique |
| 4 | `GET /api/admin/stats` sur `usage_logs.jsonl` vide | 500 KeyError possible | Au démarrage | Bloquant |
| 5 | Erreurs TinyDB thread-safety si 2 utilisateurs simultanés sans lock | 500 | Sous charge | Dégradé |

---

## Prérequis V2

Les éléments suivants doivent être en place **avant de démarrer V2** :

### Architecture & Qualité (CRITIQUES)

- [ ] **Unifier auth.py → db.py** — supprimer le double chemin JWT
- [ ] **Tests Pytest backend** — minimum 80% coverage sur : auth, DAG engine, RAG store, parsing rankings
- [ ] **Tests Vitest frontend** — composants ChatInterface, Stage1/2/3, AdminPanel
- [ ] **Logging structuré JSON** — remplacer tous les `print()` par `structlog` avec niveaux INFO/ERROR/DEBUG et contexte `user_id`/`request_id`
- [ ] **Gestion d'erreurs uniforme** — format `{"error": "...", "code": "...", "detail": "..."}` sur toutes les routes

### API

- [ ] **Versioning `/api/v1/`** — préfixer toutes les routes existantes, mettre à jour `api.js`
- [ ] **Rate limiting** — `slowapi` sur `/api/auth/login` (5 req/min par IP) et endpoints LLM

### Sécurité

- [ ] **JWT en httpOnly cookie** — supprimer localStorage, implémenter cookie sécurisé côté FastAPI
- [ ] **CSRF protection** — middleware `fastapi-csrf-protect`
- [ ] **Validation taille upload** — limite 100 Mo, extraction dans thread séparé

### RAG

- [ ] **Score threshold effectif** — filtrer les résultats LanceDB sous le seuil
- [ ] **Chunking configurable par pipeline** — taille chunk et overlap exposés dans PipelineEditor
- [ ] **Metadata LanceDB cohérentes** — s'assurer que `folder_id`, `user_id`, `service_id`, `timestamp` sont présents sur tous les chunks existants

### Pipelines

- [ ] **Nœud RAG Search opérationnel** — tester end-to-end dans PipelineEditor (sélection dossier → injection chunks → réponse LLM)
- [ ] **Timeout global DAG** — `asyncio.wait_for(execute_dag, timeout=300)`
- [ ] **Trace DAG lisible** — s'assurer que `node_start`/`node_done` SSE events contiennent timing, tokens, coût estimé

### Auth

- [ ] **Refresh token** — implémenter rotation token (TTL 8h access, 7j refresh)
- [ ] **Forçage changement mot de passe** — flag `must_change_password` sur admin créé automatiquement

---

## Prérequis V3

Les éléments suivants doivent être en place **avant de démarrer V3** :

### Grammaire cognitive .cog

- [ ] **Format .cog défini** — spécification YAML/JSON du format : nœuds, connexions, rôles, modèles, critères
- [ ] **Parser .cog implémenté** — `parse_cog_file(path) → DAG dict` compatible avec `dag_engine.py`
- [ ] **PipelineEditor → export .cog** — bouton "Export .cog" dans l'UI
- [ ] **Exemples .cog** — 3 pipelines d'exemple documentés (général, code, analyse)

### Mode Caféine

- [ ] **Mécanisme défini** — documenter dans CLAUDE.md ce que Mode Caféine doit faire (validation post-Chairman ?)
- [ ] **Interface de validation** — composant React pour approve/reject la synthèse avant envoi final
- [ ] **Backend endpoint** — `POST /api/v1/conversations/{id}/validate-stage3`

### Scoring qualité LLM

- [ ] **Métriques définies** — list des dimensions : pertinence, précision, exhaustivité, format (score 0-10 par dimension)
- [ ] **Collecte par réponse** — stocker scores dans `storage.py` par message
- [ ] **Agrégation** — endpoint `GET /api/v1/stats/model-scores` par modèle/période
- [ ] **Affichage** — widget dans AdminPanel > État modèles

### Infrastructure multi-agents

- [ ] **claude-code-mcp-enhanced configuré** — MCP server opérationnel pour les agents de dev
- [ ] **CLAUDE.md mis à jour** — refléter l'architecture V2 complète avant d'entamer V3
- [ ] **Système briefs multi-agents testé** — workflow Agent → sous-agents → rapport validé

### Open-core (si publication)

- [ ] **README complet** — architecture, stack, démarrage, configuration, contributing guide
- [ ] **CHANGELOG.md** — historique depuis V1
- [ ] **Licence choisie** — MIT / AGPL / propriétaire
- [ ] **.gitignore complet** — exclure `data/`, `.env`, `*.log`, `data/lancedb/`
- [ ] **.env.example** — déjà présent, vérifier exhaustivité
- [ ] **Tag git v1.0** — premier commit stable tagué

### CI/CD

- [ ] **Docker Compose** — services `backend` (Python) + `frontend` (Node) + volumes `data/`
- [ ] **Github Actions** — pipeline : lint → tests → build → (optionnel) deploy
- [ ] **Secrets management** — `OPENROUTER_API_KEY` via secrets GitHub, pas en `.env` hardcodé

---

## Résumé exécutif

| Domaine | Score V1 | Verdict |
|---|---|---|
| Fonctionnalités métier (council, RAG, DAG) | 7/10 | Bon, quelques lacunes |
| Sécurité | 3/10 | Insuffisant pour production |
| Qualité code (tests, logs) | 1/10 | Critique |
| Architecture & maintenabilité | 5/10 | Moyen |
| Prêt pour V2 | 2/10 | Non — prérequis bloquants |

**Les deux bloqueurs absolus pour V2 :**
1. Implémenter des tests (0% → 80% coverage backend)
2. Unifier l'authentification (auth.py → db.py) et sécuriser le JWT (localStorage → httpOnly cookie)

Sans ces deux points, V2 introduira des régressions non détectées et héritera de la dette de sécurité V1.
