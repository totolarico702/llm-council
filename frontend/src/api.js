/**
 * API client for the LLM Council backend.
 * Auth: httpOnly cookies (llmc_token + llmc_refresh), pas de localStorage pour le token.
 * User info (login, role, etc.) stocké dans localStorage (données non-sensibles).
 *
 * Ce fichier réexporte apiFetch depuis ./api/client et ROUTES depuis ./api/routes
 * pour assurer la backward-compatibility avec tous les composants existants.
 */

export { apiFetch, apiJSON } from './api/client.js';
export { ROUTES } from './api/routes.js';
import { apiFetch } from './api/client.js';
import { ROUTES } from './api/routes.js';

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

// ── API ───────────────────────────────────────────────────────────────────────
export const api = {
  auth,

  // Auth
  async login(login, password) {
    const res = await apiFetch(ROUTES.auth.login, {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });
    const data = await res.json();
    auth.setSession(null, data.user);
    return data.user;
  },
  async me()           {
    const res = await apiFetch(ROUTES.auth.me);
    return res.json();
  },
  async updateMe(data) {
    const res = await apiFetch(ROUTES.auth.me, { method: 'PATCH', body: JSON.stringify(data) });
    return res.json();
  },
  async logout() {
    await apiFetch(ROUTES.auth.logout, { method: 'POST' }).catch(() => {});
    auth.clearSession();
  },
  async changePassword(new_password) {
    const res = await apiFetch(ROUTES.auth.changePassword, { method: 'POST', body: JSON.stringify({ new_password }) });
    return res.json();
  },

  // Admin — Users
  async listUsers()          {
    const res = await apiFetch(ROUTES.admin.users);
    return res.json();
  },
  async createUser(data)     {
    const res = await apiFetch(ROUTES.admin.users, { method: 'POST', body: JSON.stringify(data) });
    return res.json();
  },
  async updateUser(id, data) {
    const res = await apiFetch(ROUTES.admin.user(id), { method: 'PATCH', body: JSON.stringify(data) });
    return res.json();
  },
  async deleteUser(id)       {
    const res = await apiFetch(ROUTES.admin.user(id), { method: 'DELETE' });
    if (res && res.status !== 204) return res.json();
    return null;
  },
  async softArchiveUser(id)  {
    const res = await apiFetch(ROUTES.admin.userSoftArchive(id), { method: 'POST' });
    return res.json();
  },
  async reactivateUser(id)   {
    const res = await apiFetch(ROUTES.admin.userReactivate(id), { method: 'POST' });
    return res.json();
  },

  // Admin — Services
  async listServices()          {
    const res = await apiFetch(ROUTES.admin.services);
    return res.json();
  },
  async createService(data)     {
    const res = await apiFetch(ROUTES.admin.services, { method: 'POST', body: JSON.stringify(data) });
    return res.json();
  },
  async updateService(id, data) {
    const res = await apiFetch(ROUTES.admin.service(id), { method: 'PATCH', body: JSON.stringify(data) });
    return res.json();
  },
  async deleteService(id)       {
    const res = await apiFetch(ROUTES.admin.service(id), { method: 'DELETE' });
    if (res && res.status !== 204) return res.json();
    return null;
  },

  // Admin — Stats
  async getStats(period = 'day', limit = 30) {
    const res = await apiFetch(`${ROUTES.admin.stats}?period=${period}&limit=${limit}`);
    return res.json();
  },

  // Pipelines — simulation de coûts
  async estimatePipelineCost(pipeline) {
    const res = await apiFetch(ROUTES.pipelines.estimateCost, {
      method: 'POST',
      body: JSON.stringify({ pipeline }),
    });
    if (!res || !res.ok) return null;
    return res.json();
  },

  // Pipelines autorisés
  async getAllowedPipelines() {
    const res = await apiFetch(ROUTES.pipelines.allowed);
    return res.json();
  },

  // Permissions
  async listPermissions()                 {
    const res = await apiFetch(ROUTES.admin.permissions);
    return res.json();
  },
  async listPermissionsForSubject(subject){
    const res = await apiFetch(ROUTES.admin.permissionSubject(subject));
    return res.json();
  },
  async grantPermission(subject, resource, action = 'use', granted = true) {
    const res = await apiFetch(ROUTES.admin.permissions, { method: 'POST', body: JSON.stringify({ subject, resource, action, granted }) });
    return res.json();
  },
  async revokePermission(permId)          {
    const res = await apiFetch(ROUTES.admin.permission(permId), { method: 'DELETE' });
    if (res && res.status !== 204) return res.json();
    return null;
  },

  // Conversations
  async listConversations()    {
    const res = await apiFetch(ROUTES.conversations.list);
    return res.json();
  },
  async createConversation()   {
    const res = await apiFetch(ROUTES.conversations.create, { method: 'POST', body: '{}' });
    return res.json();
  },
  async getConversation(id)    {
    const res = await apiFetch(ROUTES.conversations.get(id));
    return res.json();
  },
  async renameConversation(id, title) {
    const res = await apiFetch(ROUTES.conversations.updateTitle(id), {
      method: 'PATCH', body: JSON.stringify({ title }),
    });
    return res.json();
  },
  async deleteConversation(id) {
    const res = await apiFetch(ROUTES.conversations.delete(id), { method: 'DELETE' });
    if (res && res.status !== 204) return res.json();
    return null;
  },

  // Message stream (SSE — credentials:include)
  async sendMessageStream(conversationId, content, models, webSearchMode, onEvent, _options = {}, documentContent = null, pipelineNodes = null, caffeineMode = false, pipelineInfo = null) {
    const { signal } = _options;
    const res = await apiFetch(
      ROUTES.conversations.stream(conversationId),
      {
        method: 'POST',
        signal,
        body: JSON.stringify({
          content,
          models:           models || [],
          web_search_mode:  webSearchMode || 'none',
          document_content: documentContent,
          pipeline_nodes:   pipelineNodes || null,
          cafeine_mode:     caffeineMode || false,
          pipeline_id:      pipelineInfo?.id   || null,
          pipeline_name:    pipelineInfo?.name || null,
        }),
      }
    );
    if (!res) return;
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

  // Mode Caféine — validation humaine
  async getPendingValidation(convId) {
    const res = await apiFetch(ROUTES.conversations.pendingValidation(convId));
    if (!res || !res.ok) return null;
    return res.json();
  },
  async submitValidation(convId, payload) {
    const res = await apiFetch(ROUTES.conversations.validate(convId), {
      method: 'POST', body: JSON.stringify(payload),
    });
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    return res.json();
  },

  // Scores qualité LLM
  async submitScore(data) {
    const res = await apiFetch(ROUTES.scores.submit, {
      method: 'POST', body: JSON.stringify(data),
    });
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    return res.json();
  },
  async getScoresSummary(days = 30, model = null) {
    const params = new URLSearchParams({ days });
    if (model) params.set('model', model);
    const res = await apiFetch(`${ROUTES.scores.summary}?${params}`);
    return res?.ok ? res.json() : [];
  },
  async getAdminScores(days = null) {
    const params = days ? `?days=${days}` : '';
    const res = await apiFetch(`${ROUTES.scores.adminAll}${params}`);
    return res?.ok ? res.json() : [];
  },

  // Score pipeline (1-5 étoiles)
  async submitPipelineScore(pipelineId, data) {
    const res = await apiFetch(ROUTES.pipelines.score(pipelineId), {
      method: 'POST', body: JSON.stringify(data),
    });
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    return res.json();
  },

  // Credits
  async getCredits() {
    const res = await apiFetch(ROUTES.credits);
    return res.json();
  },

  // Projects
  async listProjects()              {
    const res = await apiFetch(ROUTES.projects.list);
    return res.json();
  },
  async createProject(name)         {
    const res = await apiFetch(ROUTES.projects.create, { method: 'POST', body: JSON.stringify({ name }) });
    return res.json();
  },
  async deleteProject(id)           {
    const res = await apiFetch(ROUTES.projects.delete(id), { method: 'DELETE' });
    if (res && res.status !== 204) return res.json();
    return null;
  },
  async renameProject(id, name)     {
    const res = await apiFetch(ROUTES.projects.update(id), { method: 'PATCH', body: JSON.stringify({ name }) });
    return res.json();
  },
  async assignToProject(convId, projectId) {
    const res = await apiFetch(ROUTES.conversations.setProject(convId), { method: 'PATCH', body: JSON.stringify({ project_id: projectId }) });
    return res.json();
  },

  // Upload
  async uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(ROUTES.upload, {
      method: 'POST',
      body:   form,
    });
    if (!res || !res.ok) throw new Error(`Upload failed: ${res?.status}`);
    return res.json();
  },

  // Export
  async exportProject(projectId, conversationIds) {
    const res = await apiFetch(ROUTES.projects.export(projectId), {
      method: 'POST',
      body:   JSON.stringify({ conversation_ids: conversationIds }),
    });
    if (!res || !res.ok) throw new Error('Export failed');
    return res.blob();
  },
};
