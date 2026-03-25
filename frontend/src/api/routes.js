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
    list:         `${BASE}/pipelines`,
    create:       `${BASE}/pipelines`,
    get:          (id) => `${BASE}/pipelines/${id}`,
    update:       (id) => `${BASE}/pipelines/${id}`,
    delete:       (id) => `${BASE}/pipelines/${id}`,
    allowed:      `${BASE}/pipelines/allowed`,
    importCog:    `${BASE}/pipelines/import-cog`,
    validateCog:  `${BASE}/pipelines/validate-cog`,
    exportCog:    (id) => `${BASE}/pipelines/${id}/export-cog`,
    assistant:    `${BASE}/pipelines/assistant`,
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
    permissionSubject: (s) => `${BASE}/admin/permissions/subject/${encodeURIComponent(s)}`,
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

  // ── Image ──────────────────────────────────────────────
  image: {
    models:         `${BASE}/image/models`,
    list:           `${BASE}/images`,
    enhancePrompt:  `${BASE}/image/enhance-prompt`,
    generate:       `${BASE}/image/generate`,
    delete:         (id) => `${BASE}/images/${id}`,
  },

  // ── Preferences ────────────────────────────────────────
  preferences: {
    get:            `${BASE}/preferences`,
    save:           `${BASE}/preferences`,
    testKey:        `${BASE}/preferences/test-key`,
  },
}

export default ROUTES
