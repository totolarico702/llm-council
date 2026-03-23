# BRIEF_PREREQUIS_V2 — Tâches priorisées avant V2

## Contexte

Basé sur l'audit V1 du 23 mars 2026.
Objectif : mettre LLM Council en état de démarrer V2 sans dette bloquante.
Chaque session est indépendante et livrable séparément.

---

## SESSION 1 — Unification authentification (BLOQUANT)

### Problème
`auth.py` et `db.py` coexistent avec deux chemins JWT/bcrypt différents.
`data/users.json` vs `data/db.json` — confusion sur lequel est actif.

### Tâches
1. Identifier quelle implémentation est réellement utilisée par les routes actives
2. Migrer tous les users de `data/users.json` vers `data/db.json` si nécessaire
3. Supprimer `auth.py` et toutes ses imports dans le projet
4. Vérifier que toutes les routes utilisent uniquement `db.py` pour l'auth
5. Tester login admin + login user non-admin + déconnexion
6. Supprimer `data/users.json` si plus utilisé

### Fichiers concernés
- `backend/auth.py` → supprimer
- `backend/db.py` → source unique de vérité
- `backend/main.py` → vérifier imports
- `data/users.json` → migrer puis supprimer

### Critères de validation
- [ ] Un seul chemin d'authentification actif
- [ ] Login admin fonctionne
- [ ] Login user fonctionne
- [ ] `auth.py` supprimé
- [ ] Aucune import de `auth.py` restante dans le projet

---

## SESSION 2 — Sécurité JWT (BLOQUANT)

### Problème
- JWT secret par défaut non forcé en production
- Token stocké en `localStorage` (vulnérable XSS)
- Pas de refresh token (expiration 8h non gérée)
- Admin créé avec mot de passe `admin` sans forçage de changement

### Tâches
1. **Secret JWT** — ajouter check au démarrage :
```python
if os.getenv("PRODUCTION", "0") == "1" and JWT_SECRET == "llm-council-dev-secret-CHANGE-IN-PROD":
    raise RuntimeError("JWT_SECRET must be changed in production")
```

2. **httpOnly cookie** — migrer le token JWT de `localStorage` vers cookie httpOnly :
   - Backend : `response.set_cookie("token", value, httponly=True, samesite="lax", secure=False)`
   - Frontend : supprimer `localStorage.setItem("token", ...)`, utiliser `credentials: "include"` sur les fetch
   - Toutes les routes protégées : lire le cookie au lieu du header Authorization

3. **Refresh token** — implémenter rotation :
   - Access token TTL : 8h
   - Refresh token TTL : 7 jours, stocké en httpOnly cookie séparé
   - Route `POST /api/auth/refresh` → retourne nouveau access token
   - Frontend : interceptor qui appelle `/refresh` si réponse 401

4. **Forçage changement mot de passe admin** :
   - Ajouter flag `must_change_password: bool` dans le modèle user TinyDB
   - Admin créé au démarrage → `must_change_password: True`
   - Frontend : si flag actif après login → redirect vers page changement mot de passe obligatoire
   - Route `POST /api/auth/change-password` → met le flag à False

### Critères de validation
- [ ] JWT secret par défaut lève une RuntimeError si PRODUCTION=1
- [ ] Token en httpOnly cookie (plus de localStorage)
- [ ] Refresh token fonctionne (session survive après 8h)
- [ ] Admin au premier login → forcé à changer son mot de passe

---

## SESSION 3 — Sécurité upload & rate limiting

### Problème
- Upload fichiers sans limite de taille (DoS possible)
- Extraction PDF/DOCX bloque l'event loop
- Brute force possible sur `/api/auth/login`

### Tâches
1. **Limite taille upload** :
```python
# Dans la route upload
MAX_SIZE = 100 * 1024 * 1024  # 100 Mo
if file.size > MAX_SIZE:
    raise HTTPException(413, "Fichier trop volumineux (max 100 Mo)")
```

2. **Extraction dans thread séparé** :
```python
import asyncio
text = await asyncio.to_thread(extract_text_from_file, file_path)
```

3. **Rate limiting login** — installer `slowapi` :
```python
from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)

@router.post("/api/auth/login")
@limiter.limit("5/minute")
async def login(...):
```

4. **CSRF protection** (si temps disponible) — `fastapi-csrf-protect` sur les routes POST/PUT/DELETE

### Critères de validation
- [ ] Upload > 100 Mo retourne 413
- [ ] Extraction ne bloque pas les autres requêtes
- [ ] 6 tentatives login en 1 minute → bloqué

---

## SESSION 4 — Logging structuré & gestion d'erreurs

### Problème
- `print()` partout dans le backend (pas de niveaux, pas de contexte)
- Format d'erreur incohérent entre les routes
- `usage_logs.jsonl` écrit sans file lock (race condition)

### Tâches
1. **Logging structuré** — installer `structlog` :
```python
import structlog
log = structlog.get_logger()

# Remplacer tous les print() par :
log.info("message", user_id=user_id, request_id=request_id)
log.error("erreur", exc_info=True, route="/api/...")
```

2. **Format d'erreur uniforme** — créer `backend/errors.py` :
```python
def api_error(code: str, message: str, detail: str = None, status: int = 400):
    raise HTTPException(status, detail={"error": message, "code": code, "detail": detail})
```
Appliquer sur toutes les routes existantes.

3. **Race condition usage_logs** — remplacer append JSONL par TinyDB :
```python
# Remplacer usage_logger.py par insertion TinyDB dans collection "usage_logs"
# Ajouter asyncio.Lock() si TinyDB non thread-safe
```

4. **Error Boundary React** :
```jsx
// Wrapper dans App.jsx
<ErrorBoundary fallback={<ErrorPage message="Une erreur inattendue s'est produite" />}>
  <App />
</ErrorBoundary>
```

### Critères de validation
- [ ] 0 `print()` restant dans le backend
- [ ] Toutes les routes retournent `{"error": ..., "code": ..., "detail": ...}` en cas d'erreur
- [ ] `usage_logs.jsonl` remplacé par TinyDB
- [ ] Error Boundary en place dans React

---

## SESSION 5 — Fixes RAG & DAG

### Problème
- Score threshold présent dans la signature mais ignoré dans LanceDB
- Pas de timeout global DAG (pipeline de 10 nœuds peut bloquer 5 min)
- Parsing Stage 2 silencieusement vide sans warning

### Tâches
1. **Score threshold effectif** dans `rag_store.py` :
```python
results = await table.search(query_vector).limit(limit).to_list()
results = [r for r in results if r["_distance"] <= (1 - score_threshold)]
```

2. **Timeout global DAG** dans `dag_engine.py` :
```python
try:
    result = await asyncio.wait_for(execute_dag(pipeline, context), timeout=300)
except asyncio.TimeoutError:
    raise HTTPException(504, "Pipeline timeout après 5 minutes")
```

3. **Warning parsing Stage 2** dans `ranking_parser.py` :
```python
if not rankings:
    log.warning("parse_ranking_empty", model=model_id, raw_text=text[:200])
    # Retourner un indicateur d'échec dans la réponse SSE
```

4. **Nettoyage dépendances** :
   - Supprimer `chromadb-client` de `pyproject.toml`
   - Vérifier et documenter ou supprimer `main_patch.py`

### Critères de validation
- [ ] Score threshold filtre réellement les résultats LanceDB
- [ ] Pipeline > 5 min retourne une erreur 504 propre
- [ ] Parsing Stage 2 vide → warning dans les logs + indicateur dans l'UI
- [ ] `chromadb-client` supprimé de `pyproject.toml`

---

## SESSION 6 — Tests backend (Pytest)

### Problème
- 0% couverture de tests
- Régressions non détectables

### Tâches
Créer `backend/tests/` avec :

1. `test_auth.py` — login valide, login invalide, token expiré, refresh token
2. `test_rag.py` — upload document, search avec score threshold, suppression
3. `test_dag.py` — exécution pipeline simple, timeout, nœud en erreur
4. `test_users.py` — CRUD users, permissions, isolation
5. `conftest.py` — fixtures : client FastAPI test, TinyDB en mémoire, mock OpenRouter

```bash
pip install pytest pytest-asyncio httpx --break-system-packages
pytest backend/tests/ --cov=backend --cov-report=term-missing
```

Objectif : **80% coverage** sur auth, DAG engine, RAG store, parsing rankings.

### Critères de validation
- [ ] `pytest backend/tests/` passe sans erreur
- [ ] Coverage ≥ 80% sur les 4 modules critiques
- [ ] CI-ready (pas de dépendances externes hardcodées)

---

## SESSION 7 — Versioning API & nettoyage

### Tâches
1. **Préfixer toutes les routes** `/api/` → `/api/v1/`
2. **Mettre à jour `api.js`** frontend avec le nouveau préfixe
3. **Déplacer les briefs** `BRIEF_*.md` de la racine vers `docs/briefs/`
4. **Standardiser les commentaires** code en anglais
5. **CLAUDE.md** — créer/mettre à jour avec l'architecture V1 complète :
   - Stack, ports, conventions, règles absolues, ce qui est fait, roadmap V2

### Critères de validation
- [ ] Toutes les routes répondent sur `/api/v1/`
- [ ] Frontend fonctionne avec le nouveau préfixe
- [ ] `docs/briefs/` créé avec tous les briefs déplacés
- [ ] `CLAUDE.md` à la racine, complet et à jour

---

## Ordre d'exécution recommandé

| Ordre | Session | Priorité | Durée estimée |
|-------|---------|----------|---------------|
| 1 | Session 1 — Unification auth | 🔴 Bloquant | 1-2h |
| 2 | Session 2 — Sécurité JWT | 🔴 Bloquant | 2-3h |
| 3 | Session 4 — Logging & erreurs | 🟠 Important | 1-2h |
| 4 | Session 5 — Fixes RAG & DAG | 🟠 Important | 1h |
| 5 | Session 3 — Upload & rate limiting | 🟡 Utile | 1h |
| 6 | Session 6 — Tests Pytest | 🟠 Important | 3-4h |
| 7 | Session 7 — Versioning & nettoyage | 🟢 Nice-to-have | 1h |
