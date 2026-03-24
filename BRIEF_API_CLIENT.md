# BRIEF_API_CLIENT — Client API centralisé + Registre de routes

## Contexte

Le frontend LLM Council a actuellement des appels `fetch` dispersés dans ~20 fichiers JSX
avec des problèmes récurrents :
- Header `Authorization: Bearer` hardcodé dans certains composants (cause des 401)
- URLs `/api/v1/...` dupliquées partout (risque de typo, versioning difficile)
- Pas de gestion centralisée des erreurs HTTP

Ce brief crée deux fichiers :
1. `frontend/src/api/routes.js` — registre centralisé de toutes les routes
2. `frontend/src/api/client.js` — client fetch unique avec cookies, erreurs, et versioning

L'objectif est aussi de faciliter les forks et contributions externes — un nouveau
développeur comprend toute l'API en lisant un seul fichier.

---

## 1. `frontend/src/api/routes.js` — Registre des routes

```javascript
// frontend/src/api/routes.js
// Registre centralisé de toutes les routes API LLM Council
// Pour changer de v1 à v2 : modifier API_VERSION ici uniquement

const API_VERSION = 'v1'
const BASE = `/api/${API_VERSION}`

export const ROUTES = {
  // ── Auth ──────────────────────────────────────────────
  auth: {
    login:          `${BASE}/auth/login`,
    logout:         `${BASE}/auth/logout`,
    refresh:        `${BASE}/auth/refresh`,
    me:             `${BASE}/auth/me`,
    changePassword: `${BASE}/auth/change-password`,
  },

  // ── Conversations ──────────────────────────────────────
  conversations: {
    list:           `${BASE}/conversations`,
    create:         `${BASE}/conversations`,
    get:            (id) => `${BASE}/conversations/${id}`,
    updateTitle:    (id) => `${BASE}/conversations/${id}/title`,
    delete:         (id) => `${BASE}/conversations/${id}`,
    message:        (id) => `${BASE}/conversations/${id}/message`,
    stream:         (id) => `${BASE}/conversations/${id}/message/stream`,
    setProject:     (id) => `${BASE}/conversations/${id}/project`,
  },

  // ── Projects ───────────────────────────────────────────
  projects: {
    list:           `${BASE}/projects`,
    create:         `${BASE}/projects`,
    update:         (id) => `${BASE}/projects/${id}`,
    delete:         (id) => `${BASE}/projects/${id}`,
    export:         (id) => `${BASE}/projects/${id}/export`,
  },

  // ── RAG ────────────────────────────────────────────────
  rag: {
    upload:         `${BASE}/rag/upload`,
    uploadFromPath: `${BASE}/rag/documents/from-path`,
    search:         `${BASE}/rag/search`,
    documents:      `${BASE}/rag/documents`,
    document:       (id) => `${BASE}/rag/documents/${id}`,
    documentMove:   (id) => `${BASE}/rag/documents/${id}/move`,
    documentReindex:(id) => `${BASE}/rag/documents/${id}/reindex`,
    documentPreview:(id) => `${BASE}/rag/documents/${id}/preview`,
    resolveMentions:`${BASE}/rag/resolve-mentions`,
    folders:        `${BASE}/rag/folders`,
    folder:         (id) => `${BASE}/rag/folders/${id}`,
    folderAcl:      (id) => `${BASE}/rag/folders/${id}/acl`,
    folderAclItem:  (id, aclId) => `${BASE}/rag/folders/${id}/acl/${aclId}`,
    audit:          `${BASE}/rag/audit`,
    stats:          `${BASE}/rag/stats`,
  },

  // ── Filesystem ─────────────────────────────────────────
  fs: {
    browse:         `${BASE}/fs/browse`,
  },

  // ── Models ─────────────────────────────────────────────
  models: {
    list:           `${BASE}/models`,
    status:         `${BASE}/health/models`,
    allowed:        `${BASE}/admin/allowed-models`,
    allowedDelete:  (id) => `${BASE}/admin/allowed-models/${id}`,
  },

  // ── Pipelines ──────────────────────────────────────────
  pipelines: {
    allowed:        `${BASE}/pipelines/allowed`,
  },

  // ── Local (Ollama) ─────────────────────────────────────
  local: {
    status:         `${BASE}/local/status`,
    models:         `${BASE}/local/models`,
    catalog:        `${BASE}/local/catalog`,
    pull:           `${BASE}/local/pull`,
    delete:         (name) => `${BASE}/local/models/${name}`,
  },

  // ── Credits ────────────────────────────────────────────
  credits:          `${BASE}/credits`,

  // ── Upload (fichier générique) ─────────────────────────
  upload:           `${BASE}/upload`,

  // ── Admin ──────────────────────────────────────────────
  admin: {
    users:          `${BASE}/admin/users`,
    user:           (id) => `${BASE}/admin/users/${id}`,
    userArchive:    (id) => `${BASE}/admin/users/${id}/archive`,
    userDataSummary:(id) => `${BASE}/admin/users/${id}/data-summary`,
    services:       `${BASE}/admin/services`,
    service:        (id) => `${BASE}/admin/services/${id}`,
    permissions:    `${BASE}/admin/permissions`,
    permissionSubject: (s) => `${BASE}/admin/permissions/subject/${s}`,
    permission:     (id) => `${BASE}/admin/permissions/${id}`,
    stats:          `${BASE}/admin/stats`,
    incidents:      `${BASE}/admin/incidents`,
    conversations:  `${BASE}/admin/conversations/all`,
    archiveList:    `${BASE}/admin/archive/list`,
    ragStats:       `${BASE}/admin/rag/stats`,
    settings:       `${BASE}/admin/settings`,
    dashboardToken: `${BASE}/admin/dashboard/token`,
    dashboardTokens:`${BASE}/admin/dashboard/tokens`,
    dashboardTokenDelete: (t) => `${BASE}/admin/dashboard/tokens/${t}`,
  },

  // ── Dashboard (public) ─────────────────────────────────
  dashboard:        (token) => `${BASE}/dashboard/${token}`,

  // ── Groups ─────────────────────────────────────────────
  groups: {
    list:           `${BASE}/groups`,
    create:         `${BASE}/groups`,
    update:         (id) => `${BASE}/groups/${id}`,
    delete:         (id) => `${BASE}/groups/${id}`,
  },
}

export default ROUTES
```

---

## 2. `frontend/src/api/client.js` — Client fetch centralisé

```javascript
// frontend/src/api/client.js
// Client HTTP unique pour LLM Council
// - Envoie toujours les cookies httpOnly (credentials: 'include')
// - Refresh token automatique si 401
// - Format d'erreur uniforme

let isRefreshing = false
let refreshQueue = []

const processQueue = (error) => {
  refreshQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve()
  )
  refreshQueue = []
}

/**
 * Client fetch principal — utiliser à la place de fetch() partout
 */
export async function apiFetch(url, options = {}) {
  const config = {
    credentials: 'include',           // toujours envoyer les cookies httpOnly
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }

  // Ne pas forcer Content-Type sur FormData (multipart)
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type']
  }

  let response = await fetch(url, config)

  // Refresh token automatique si 401
  if (response.status === 401) {
    if (isRefreshing) {
      // Attendre que le refresh en cours se termine
      await new Promise((resolve, reject) =>
        refreshQueue.push({ resolve, reject })
      )
      response = await fetch(url, config)
    } else {
      isRefreshing = true
      try {
        const refreshResponse = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        })
        if (refreshResponse.ok) {
          processQueue(null)
          response = await fetch(url, config)
        } else {
          processQueue(new Error('Session expirée'))
          // Rediriger vers login
          window.location.href = '/login'
          return
        }
      } finally {
        isRefreshing = false
      }
    }
  }

  return response
}

/**
 * apiFetch + parse JSON automatique
 * Lance une erreur si la réponse n'est pas ok
 */
export async function apiJSON(url, options = {}) {
  const response = await apiFetch(url, options)
  if (!response.ok) {
    let errorMessage = `Erreur ${response.status}`
    try {
      const data = await response.json()
      errorMessage = data.detail || data.error || errorMessage
    } catch {}
    throw new Error(errorMessage)
  }
  return response.json()
}

export default apiFetch
```

---

## 3. Migration — Remplacer les appels existants

### Créer le dossier
```
frontend/src/api/
├── routes.js    ← nouveau
└── client.js    ← nouveau
```

### Remplacer dans tous les fichiers JSX/JS

**Avant :**
```javascript
const res = await fetch('/api/v1/rag/folders', {
  headers: { Authorization: `Bearer ${token}` },
  credentials: 'include',
})
```

**Après :**
```javascript
import { apiJSON } from '../api/client'
import ROUTES from '../api/routes'

const data = await apiJSON(ROUTES.rag.folders)
```

### Fichiers à migrer (par priorité)

1. `frontend/src/api.js` — fichier principal existant → wrapper vers le nouveau client
2. `frontend/src/components/AdminPanel/RAGTab.jsx`
3. `frontend/src/components/AdminPanel/RAGPCExplorer.jsx`
4. `frontend/src/components/AdminPanel/RAGAuditLog.jsx`
5. `frontend/src/components/AdminPanel/RAGAclEditor.jsx`
6. `frontend/src/components/ChatInterface.jsx`
7. `frontend/src/components/AdminPanel.jsx`
8. `frontend/src/App.jsx`

### Stratégie de migration douce

Ne pas tout casser d'un coup. Approche recommandée :
1. Créer `api/routes.js` et `api/client.js`
2. Modifier `api.js` existant pour utiliser `apiFetch` en interne
3. Migrer composant par composant en testant après chaque fichier

---

## 4. Critères de validation

- [ ] `frontend/src/api/routes.js` créé avec toutes les routes
- [ ] `frontend/src/api/client.js` créé avec `apiFetch` et `apiJSON`
- [ ] `api.js` existant migré pour utiliser le nouveau client
- [ ] Plus aucun `Authorization: Bearer` dans le frontend
- [ ] Plus aucune URL `/api/v1/...` hardcodée hors de `routes.js`
- [ ] Refresh token automatique fonctionnel
- [ ] Tous les composants RAG fonctionnent après migration
- [ ] Login / logout / me fonctionnels

---

## 5. Fichiers à créer / modifier

| Fichier | Action |
|---------|--------|
| `frontend/src/api/routes.js` | Créer |
| `frontend/src/api/client.js` | Créer |
| `frontend/src/api.js` | Modifier — utiliser apiFetch en interne |
| `frontend/src/components/AdminPanel/RAG*.jsx` | Migrer |
| `frontend/src/components/ChatInterface.jsx` | Migrer |
| `frontend/src/App.jsx` | Migrer |
