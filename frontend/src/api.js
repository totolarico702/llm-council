/**
 * API client for the LLM Council backend.
 * Auth: httpOnly cookies (llmc_token + llmc_refresh), pas de localStorage pour le token.
 * User info (login, role, etc.) stocké dans localStorage (données non-sensibles).
 */

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';
export const API_V1   = `${API_BASE}/api/v1`;

// ── Session store (user info seulement, pas le token) ────────────────────────
const USER_KEY = 'llmc_user';

export const auth = {
  getUser:      () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  setSession:   (token, user) => {
    // token ignoré ici — il est stocké en httpOnly cookie par le backend
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clearSession: () => { localStorage.removeItem(USER_KEY); },
  isAdmin:      () => { const u = auth.getUser(); return u?.role === 'admin'; },
  isLoggedIn:   () => !!auth.getUser(),
  // Compatibilité : retourne null (le token est en cookie httpOnly)
  getToken:     () => null,
};

// ── Intercepteur 401 avec refresh token ──────────────────────────────────────
let _refreshing = false;

async function _tryRefresh() {
  if (_refreshing) return false;
  _refreshing = true;
  try {
    const r = await fetch(`${API_V1}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!r.ok) return false;
    const data = await r.json();
    auth.setSession(null, data.user);
    return true;
  } catch {
    return false;
  } finally {
    _refreshing = false;
  }
}

// ── Helper fetch avec cookies ─────────────────────────────────────────────────
export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_V1}${path}`;
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    // Tenter un refresh silencieux
    const refreshed = await _tryRefresh();
    if (refreshed) {
      // Rejouer la requête originale
      const retry = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      if (retry.ok) return retry.status === 204 ? null : retry.json();
    }
    auth.clearSession();
    window.location.reload();
    throw new Error('Session expirée');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.error || err.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── API ───────────────────────────────────────────────────────────────────────
export const api = {
  auth,

  // Auth
  async login(login, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });
    auth.setSession(null, data.user);
    return data.user;
  },
  async me()             { return apiFetch('/auth/me'); },
  async updateMe(data)   { return apiFetch('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }); },
  async logout()         {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    auth.clearSession();
  },
  async changePassword(new_password) {
    return apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ new_password }) });
  },

  // Admin — Users
  async listUsers()          { return apiFetch('/admin/users'); },
  async createUser(data)     { return apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(data) }); },
  async updateUser(id, data) { return apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); },
  async deleteUser(id)       { return apiFetch(`/admin/users/${id}`, { method: 'DELETE' }); },

  // Admin — Services
  async listServices()          { return apiFetch('/admin/services'); },
  async createService(data)     { return apiFetch('/admin/services', { method: 'POST', body: JSON.stringify(data) }); },
  async updateService(id, data) { return apiFetch(`/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); },
  async deleteService(id)       { return apiFetch(`/admin/services/${id}`, { method: 'DELETE' }); },

  // Admin — Stats
  async getStats(period = 'day', limit = 30) {
    return apiFetch(`/admin/stats?period=${period}&limit=${limit}`);
  },

  // Pipelines autorisés
  async getAllowedPipelines() { return apiFetch('/pipelines/allowed'); },

  // Permissions
  async listPermissions()                 { return apiFetch('/admin/permissions'); },
  async listPermissionsForSubject(subject){ return apiFetch(`/admin/permissions/subject/${encodeURIComponent(subject)}`); },
  async grantPermission(subject, resource, action = 'use', granted = true) {
    return apiFetch('/admin/permissions', { method: 'POST', body: JSON.stringify({ subject, resource, action, granted }) });
  },
  async revokePermission(permId)          { return apiFetch(`/admin/permissions/${permId}`, { method: 'DELETE' }); },

  // Conversations
  async listConversations()    { return apiFetch('/conversations'); },
  async createConversation()   { return apiFetch('/conversations', { method: 'POST', body: '{}' }); },
  async getConversation(id)    { return apiFetch(`/conversations/${id}`); },
  async renameConversation(id, title) {
    return apiFetch(`/conversations/${id}/title`, {
      method: 'PATCH', body: JSON.stringify({ title }),
    });
  },
  async deleteConversation(id) { return apiFetch(`/conversations/${id}`, { method: 'DELETE' }); },

  // Message stream (SSE — credentials:include, pas de token header)
  async sendMessageStream(conversationId, content, models, webSearchMode, onEvent, _options = {}, documentContent = null, pipelineNodes = null) {
    const res = await fetch(
      `${API_V1}/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          models:           models || [],
          web_search_mode:  webSearchMode || 'none',
          document_content: documentContent,
          pipeline_nodes:   pipelineNodes || null,
        }),
      }
    );
    if (res.status === 401) { auth.clearSession(); window.location.reload(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (line.startsWith('data: ')) {
          try { const ev = JSON.parse(line.slice(6)); onEvent(ev.type, ev); }
          catch (e) { console.error('SSE parse error:', e); }
        }
      }
    }
  },

  // Credits
  async getCredits() { return apiFetch('/credits'); },

  // Projects
  async listProjects()              { return apiFetch('/projects'); },
  async createProject(name)         { return apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) }); },
  async deleteProject(id)           { return apiFetch(`/projects/${id}`, { method: 'DELETE' }); },
  async renameProject(id, name)     { return apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); },
  async assignToProject(convId, projectId) {
    return apiFetch(`/conversations/${convId}/project`, { method: 'PATCH', body: JSON.stringify({ project_id: projectId }) });
  },

  // Upload
  async uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_V1}/upload`, {
      method:      'POST',
      credentials: 'include',
      body:        form,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  // Export
  async exportProject(projectId, conversationIds) {
    const res = await fetch(`${API_V1}/projects/${projectId}/export`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ conversation_ids: conversationIds }),
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
};
