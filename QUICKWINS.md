# QUICKWINS — LLM Council

> Rapport généré le 2026-03-17. Bugs identifiés, **non corrigés**.
> Priorité : **S** = critique/bloquant · **M** = notable · **L** = mineur/cosmétique

---

## S — Critique / Bloquant

### S1 — Boucle infinie de rechargement sur 401
**Fichier :** `frontend/src/api.js` · lignes 41–43 et 129
Si le backend renvoie 401, `apiFetch()` appelle `window.location.reload()` sans throttle ni garde.
Plusieurs requêtes simultanées avec un token expiré déclenchent autant de rechargements consécutifs, gelant le navigateur.
La même absence de protection existe dans `sendMessageStream()` (ligne 129).

### S2 — Appels à des fonctions non importées dans App.jsx
**Fichier :** `frontend/src/App.jsx` · lignes 46–47
`handleLogin()` appelle `setTokenProvider()` et `loadModels()` sans les importer.
→ `ReferenceError` au premier login, cassant tout le flux d'authentification.

### S3 — IDOR sur l'endpoint d'export
**Fichier :** `backend/main.py` · lignes ~950–970
`export_project()` ne vérifie pas que les `conversation_ids` passés dans le body appartiennent à l'utilisateur courant.
Un utilisateur non-admin peut exporter les conversations d'un autre utilisateur en connaissant leur UUID.

### S4 — JWT secret par défaut silencieux hors production
**Fichier :** `backend/auth.py` · ligne ~24
La valeur par défaut `"llm-council-dev-secret-CHANGE-IN-PROD"` est utilisée silencieusement si `PRODUCTION` n'est pas défini.
N'importe qui peut signer des tokens valides. La vérification dans `main.py` n'est active que si `PRODUCTION=1`.

### S5 — Deux versions de modelsStore.js avec des APIs différentes
**Fichiers :**
- `frontend/src/modelsStore.js` — URL hardcodée `localhost:8001`
- `frontend/src/components/modelsStore.js` — utilise `VITE_API_BASE`, expose `setTokenProvider()`

Les composants importent `../modelsStore` (ancienne version sans `VITE_API_BASE`).
En production avec un backend sur un autre host, tous les chargements de modèles échouent silencieusement.

---

## M — Notable

### M1 — Double implémentation JWT (auth.py vs db.py)
**Fichiers :** `backend/auth.py` et `backend/db.py`
Les deux modules contiennent leur propre implémentation JWT (HMAC-SHA256, base64). Une mise à jour de `JWT_SECRET` ou de l'algo dans un seul fichier crée une divergence de tokens.

### M2 — Historique de conversation sans filtre owner
**Fichier :** `backend/main.py` · ligne ~685
Dans `send_message_stream()`, `get_conversation_history(conversation_id)` est appelé sans `owner_id`.
Si la conversation a des messages d'autres utilisateurs (suite à une migration legacy), ils seront inclus dans le contexte LLM.

### M3 — Race condition sur le chargement de conversation
**Fichier :** `frontend/src/App.jsx` · lignes ~31–32
Si plusieurs messages sont envoyés rapidement vers la même conversation, `loadConversation()` peut écraser l'état non sauvegardé d'un message en cours de streaming.

### M4 — Headers Bearer dupliqués manuellement
**Fichier :** `frontend/src/api.js` · lignes 110–128, 159–166, 173–177
`sendMessageStream()`, `uploadFile()`, et `exportProject()` reconstruisent les headers Authorization manuellement au lieu d'utiliser `authHeaders()`.
Si la logique de récupération du token change, ces trois fonctions devront être mises à jour séparément.

### M5 — TinyDB non thread-safe sous charge async
**Fichier :** `backend/db.py` · ligne ~34
Le commentaire indique "thread-safe en lecture, écritures sérialisées" mais TinyDB ne garantit pas la sécurité concurrente pour les workers async de FastAPI.
Des écritures parallèles (ex. plusieurs utilisateurs archivés simultanément) peuvent corrompre `db.json`.

### M6 — `allow_origin_regex` actif même quand `allow_origins=["*"]`
**Fichier :** `backend/main.py` · lignes 79–80
Quand `_ALLOW_ALL=True`, `allow_origin_regex` vaut quand même `r"http://localhost:\d+"` au lieu de `None`.
`allow_credentials=False` en mode `*` est techniquement correct mais peut surprendre les développeurs qui ajoutent des cookies.

### M7 — `loaded` jamais réinitialisé après logout
**Fichier :** `frontend/src/modelsStore.js` (toutes versions)
Après un logout puis re-login avec un compte ayant des permissions différentes, `loadModels()` ne refait pas le fetch (`loaded=true`).
L'utilisateur voit la liste de l'ancienne session jusqu'au rechargement complet de la page.
*(Partiellement adressé par l'ajout de `reloadModels()` — mais non appelé après logout.)*

### M8 — Fichiers Python égarés dans le frontend
**Fichiers :**
- `frontend/src/components/dag_engine.py`
- `frontend/src/components/tool_executor.py`

Ces fichiers Python ne sont ni importés ni exécutables depuis le frontend. Ils ne doivent pas être dans l'arborescence Vite (risque d'être inclus dans le build ou de confondre les outils).

---

## L — Mineur / Cosmétique

### L1 — URL de base hardcodée dans modelsStore.js
**Fichier :** `frontend/src/modelsStore.js` · ligne 8
`API_BASE = 'http://localhost:8001'` au lieu de `import.meta.env.VITE_API_BASE || 'http://localhost:8001'`.
Ne bloque pas en dev mais cassera tout déploiement avec un backend sur un autre host.

### L2 — Documentation port frontend incorrecte dans .env.example
**Fichier :** `.env.example`
Le port documenté pour le frontend est 80 (Docker), mais le serveur de dev Vite utilise 5173. Peut induire en erreur lors de la configuration initiale.

### L3 — `qdrant-client` encore dans uv.lock
**Fichier :** `uv.lock`
La dépendance `qdrant-client` a été retirée de `pyproject.toml` mais reste dans `uv.lock` jusqu'au prochain `uv sync`. À exécuter pour nettoyer l'environnement.

### L4 — Console.error silencieux sur échec de chargement de modèles
**Fichier :** `frontend/src/modelsStore.js` · ligne 53
En cas d'erreur réseau, `loaded` reste `false` et `loading` repasse à `false` sans jamais repasser `true`.
Les composants abonnés ne reçoivent pas de signal d'erreur et affichent une liste vide sans explication.

### L5 — Parsing de ranking fragile sur contenu ambigu
**Fichier :** `backend/council.py` · fonction `parse_ranking_from_text()`
Le fallback regex cherche n'importe quel pattern `Response [A-Z]` dans le texte.
Si un modèle cite la réponse d'un autre dans son évaluation, ces occurrences parasites peuvent fausser le ranking parsé.

---

## Récapitulatif

| ID  | Fichier(s)                              | Problème                                       | Priorité |
|-----|-----------------------------------------|------------------------------------------------|----------|
| S1  | frontend/src/api.js:41-43, 129          | Boucle infinie rechargement sur 401            | **S**    |
| S2  | frontend/src/App.jsx:46-47              | Fonctions non importées appelées post-login    | **S**    |
| S3  | backend/main.py:~950-970                | IDOR export conversations autres users         | **S**    |
| S4  | backend/auth.py:~24                     | JWT secret par défaut silencieux               | **S**    |
| S5  | frontend/src/modelsStore.js (×2)        | Deux versions incompatibles du store           | **S**    |
| M1  | backend/auth.py + db.py                 | Double implémentation JWT divergente           | **M**    |
| M2  | backend/main.py:~685                    | Historique conversation sans filtre owner      | **M**    |
| M3  | frontend/src/App.jsx:~31-32             | Race condition sur chargement conversation     | **M**    |
| M4  | frontend/src/api.js:110-177             | Headers Bearer reconstruits manuellement ×3   | **M**    |
| M5  | backend/db.py:~34                       | TinyDB non thread-safe sous workers async      | **M**    |
| M6  | backend/main.py:79-80                   | allow_origin_regex actif avec allow_origins=* | **M**    |
| M7  | frontend/src/modelsStore.js             | Liste modèles stale après re-login             | **M**    |
| M8  | frontend/src/components/*.py            | Fichiers Python égarés dans le frontend        | **M**    |
| L1  | frontend/src/modelsStore.js:8           | API_BASE hardcodée (non-VITE_API_BASE)         | **L**    |
| L2  | .env.example                            | Port 80 vs 5173 — documentation erronée       | **L**    |
| L3  | uv.lock                                 | qdrant-client toujours présent (run uv sync)  | **L**    |
| L4  | frontend/src/modelsStore.js:53          | Pas de signal d'erreur pour la liste vide      | **L**    |
| L5  | backend/council.py                      | Parsing ranking fragile (regex ambiguë)        | **L**    |
