import { useState, useEffect, useCallback } from 'react';
import { api, apiFetch } from '../api';
import { ROUTES } from '../api/routes.js';
import PipelineEditor from './PipelineEditor';
import RAGTab         from './AdminPanel/RAGTab';
import RAGAuditLog    from './AdminPanel/RAGAuditLog';
import './AdminPanel.css';
import './AdminPanel/RAGAdmin.css';

// ── Modale générique ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="adm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="adm-modal">
        <div className="adm-modal-header">
          <h3>{title}</h3>
          <button className="adm-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="adm-modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── Onglet Users ──────────────────────────────────────────────────────────────
function UsersTab({ services }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [form,    setForm]    = useState({});
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [subTab,  setSubTab]  = useState('active'); // 'active' | 'archived'

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api.listUsers()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeUsers   = users.filter(u => !u.is_archived);
  const archivedUsers = users.filter(u =>  u.is_archived);

  const emptyForm = { login: '', password: '', role: 'user', service_id: '',
    first_name: '', last_name: '', email: '', departments: [] };

  const openCreate = () => {
    setForm(emptyForm);
    setError(''); setModal({ mode: 'create' });
  };
  const openEdit = (user) => {
    setForm({
      login: user.login, password: '', role: user.role,
      service_id: user.service_id || '',
      first_name: user.first_name || '', last_name: user.last_name || '',
      email: user.email || '', departments: user.departments || [],
    });
    setError(''); setModal({ mode: 'edit', user });
  };

  const toggleDepartment = (svcId) => setForm(f => ({
    ...f,
    departments: f.departments.includes(svcId)
      ? f.departments.filter(d => d !== svcId)
      : [...f.departments, svcId],
  }));

  const handleSave = async () => {
    setError('');
    if (!form.login?.trim()) { setError('Login requis'); return; }
    if (modal.mode === 'create' && !form.password) { setError('Mot de passe requis'); return; }
    setSaving(true);
    try {
      const payload = {
        login: form.login.trim(), role: form.role, service_id: form.service_id || null,
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        email: form.email.trim(), departments: form.departments,
        ...(form.password ? { password: form.password } : {}),
      };
      if (modal.mode === 'create') await api.createUser({ ...payload, password: form.password });
      else await api.updateUser(modal.user.id, payload);
      setModal(null); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (user) => {
    try { await api.deleteUser(user.id); setConfirm(null); load(); }
    catch (e) { console.error(e); }
  };

  const handleSoftArchive = async (user) => {
    if (!window.confirm(`Archiver ${user.login} ? Le compte sera désactivé (réversible).`)) return;
    try { await api.softArchiveUser(user.id); load(); }
    catch (e) { alert(`Erreur : ${e.message}`); }
  };

  const handleReactivate = async (user) => {
    try { await api.reactivateUser(user.id); load(); }
    catch (e) { alert(`Erreur : ${e.message}`); }
  };

  const [archiving,      setArchiving]      = useState(null);   // user en cours d'analyse
  const [archivePreview, setArchivePreview] = useState(null);   // résultat preview
  const [archiveBusy,    setArchiveBusy]    = useState(false);

  const handleArchiveStart = async (user) => {
    setArchiving(user);
    setArchivePreview(null);
    setArchiveBusy(true);
    try {
      const res = await apiFetch(`${ROUTES.admin.userArchive(user.id)}/preview`);
      const preview = res && res.ok ? await res.json() : null;
      setArchivePreview(preview);
    } catch (e) {
      alert(`Erreur analyse : ${e.message}`);
      setArchiving(null);
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiving) return;
    setArchiveBusy(true);
    try {
      const res = await apiFetch(ROUTES.admin.userArchive(archiving.id), { method: 'POST' });
      const result = res && res.ok ? await res.json() : {};
      alert(`✅ ${result.login} archivé — ${result.chunks} chunks RAG ingérés`);
      setArchiving(null);
      setArchivePreview(null);
      load();
    } catch (e) {
      alert(`Erreur archivage : ${e.message}`);
    } finally {
      setArchiveBusy(false);
    }
  };

  const serviceLabel = (id) => services.find(s => s.id === id)?.name || '—';
  const displayName  = (u) => (u.first_name || u.last_name)
    ? `${u.first_name} ${u.last_name}`.trim()
    : u.login;

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <div className="adm-subtabs">
          <button className={`adm-subtab${subTab === 'active' ? ' active' : ''}`} onClick={() => setSubTab('active')}>
            Actifs <span className="adm-count-badge">{activeUsers.length}</span>
          </button>
          <button className={`adm-subtab${subTab === 'archived' ? ' active' : ''}`} onClick={() => setSubTab('archived')}>
            Archivés <span className="adm-count-badge">{archivedUsers.length}</span>
          </button>
        </div>
        {subTab === 'active' && (
          <button className="adm-btn-primary" onClick={openCreate}>+ Nouvel utilisateur</button>
        )}
      </div>

      {loading ? <div className="adm-loading">Chargement…</div> : subTab === 'active' ? (
        <table className="adm-table">
          <thead><tr><th>Login</th><th>Nom</th><th>Rôle</th><th>Service</th><th>Dernière connexion</th><th></th></tr></thead>
          <tbody>
            {activeUsers.map(u => (
              <tr key={u.id}>
                <td className="adm-cell-login">
                  <span className="adm-avatar">{u.login[0].toUpperCase()}</span>{u.login}
                </td>
                <td className="adm-cell-name">{displayName(u)}</td>
                <td><span className={`adm-badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>{u.role}</span></td>
                <td>{serviceLabel(u.service_id)}</td>
                <td className="adm-cell-date">{u.last_login?.slice(0, 10) || '—'}</td>
                <td className="adm-cell-actions">
                  <button className="adm-btn-icon" onClick={() => openEdit(u)}>✏</button>
                  {u.role !== 'admin' && (
                    <button className="adm-btn-icon adm-btn-archive" title="Désactiver (soft archive)"
                      onClick={() => handleSoftArchive(u)}>🔒</button>
                  )}
                  {u.role !== 'admin' && (
                    <button className="adm-btn-icon adm-btn-archive" title="Archiver définitivement (RAG)"
                      onClick={() => handleArchiveStart(u)}>📦</button>
                  )}
                  <button className="adm-btn-icon adm-btn-danger" onClick={() => setConfirm(u)}>🗑</button>
                </td>
              </tr>
            ))}
            {activeUsers.length === 0 && <tr><td colSpan={6} className="adm-empty">Aucun utilisateur actif</td></tr>}
          </tbody>
        </table>
      ) : (
        <table className="adm-table">
          <thead><tr><th>Login</th><th>Nom</th><th>Archivé le</th><th>Par</th><th></th></tr></thead>
          <tbody>
            {archivedUsers.map(u => (
              <tr key={u.id} className="adm-row-archived">
                <td className="adm-cell-login">
                  <span className="adm-avatar adm-avatar-archived">{u.login[0].toUpperCase()}</span>
                  {u.login}
                  <span className="adm-badge-archived">ARCHIVÉ</span>
                </td>
                <td className="adm-cell-name">{displayName(u)}</td>
                <td className="adm-cell-date">{u.archived_at?.slice(0, 10) || '—'}</td>
                <td>{u.archived_by || '—'}</td>
                <td className="adm-cell-actions">
                  <button className="adm-btn-primary" onClick={() => handleReactivate(u)}>Réactiver</button>
                  <button className="adm-btn-icon adm-btn-danger" onClick={() => setConfirm(u)}>🗑</button>
                </td>
              </tr>
            ))}
            {archivedUsers.length === 0 && <tr><td colSpan={5} className="adm-empty">Aucun utilisateur archivé</td></tr>}
          </tbody>
        </table>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouvel utilisateur' : `Modifier ${modal.user.login}`} onClose={() => setModal(null)}>
          <div className="adm-form">
            <div className="adm-form-row">
              <div>
                <label>Prénom</label>
                <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="Jean" />
              </div>
              <div>
                <label>Nom</label>
                <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Dupont" />
              </div>
            </div>
            <label>Login</label>
            <input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="jean.dupont" />
            <label>Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jean.dupont@entreprise.fr" />
            <label>Mot de passe {modal.mode === 'edit' && <span className="adm-hint">(vide = inchangé)</span>}</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
            <label>Rôle</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="user">Utilisateur</option>
              <option value="admin">Administrateur</option>
            </select>
            <label>Service principal</label>
            <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}>
              <option value="">— Aucun —</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {services.length > 0 && (
              <>
                <label>Départements</label>
                <div className="adm-checkbox-group">
                  {services.map(s => (
                    <label key={s.id} className="adm-checkbox-row">
                      <input type="checkbox"
                        checked={form.departments.includes(s.id)}
                        onChange={() => toggleDepartment(s.id)} />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {error && <div className="adm-form-error">⚠ {error}</div>}
            <div className="adm-form-actions">
              <button className="adm-btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button className="adm-btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title="Confirmer la suppression" onClose={() => setConfirm(null)}>
          <p className="adm-confirm-text">Supprimer <strong>{confirm.login}</strong> ? Action irréversible.</p>
          <div className="adm-form-actions">
            <button className="adm-btn-ghost" onClick={() => setConfirm(null)}>Annuler</button>
            <button className="adm-btn-danger-solid" onClick={() => handleDelete(confirm)}>Supprimer</button>
          </div>
        </Modal>
      )}

      {archiving && (
        <Modal title={`Archiver ${archiving.login}`} onClose={() => { setArchiving(null); setArchivePreview(null); }}>
          {archiveBusy && !archivePreview && (
            <div className="adm-archive-loading">
              <div className="spinner" />
              <p>Analyse en cours avec Claude Sonnet…<br/>
                <small>Lecture des conversations et extraction des compétences</small>
              </p>
            </div>
          )}
          {archivePreview && (
            <div className="adm-archive-preview">
              <div className="adm-archive-stats">
                <span>💬 {archivePreview.stats?.conversations} conversations</span>
                <span>📁 {archivePreview.stats?.projects} projets</span>
                <span>🧩 {archivePreview.chunks?.length} chunks RAG</span>
              </div>

              <div className="adm-archive-section">
                <h4>Résumé</h4>
                <p>{archivePreview.summary}</p>
              </div>

              {archivePreview.skills?.length > 0 && (
                <div className="adm-archive-section">
                  <h4>Compétences identifiées</h4>
                  <div className="adm-tags">
                    {archivePreview.skills.map(s => (
                      <span key={s} className="adm-tag" style={{ background: 'rgba(184,148,31,.08)', color: '#d4aa2a', borderColor: 'rgba(184,148,31,.25)' }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {archivePreview.note_successor && (
                <div className="adm-archive-section">
                  <h4>Note de passation</h4>
                  <p className="adm-archive-note">{archivePreview.note_successor}</p>
                </div>
              )}

              <div className="adm-archive-warning">
                ⚠ Cette action est irréversible. Le user sera supprimé et son dossier
                déplacé dans <code>data/archive/</code> avec <code>synthesis.md</code> et
                les chunks ingérés dans le RAG.
              </div>

              <div className="adm-form-actions">
                <button className="adm-btn-ghost" onClick={() => { setArchiving(null); setArchivePreview(null); }}>
                  Annuler
                </button>
                <button className="adm-btn-archive-confirm" onClick={handleArchiveConfirm} disabled={archiveBusy}>
                  {archiveBusy ? 'Archivage…' : '📦 Confirmer l\'archivage'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── Onglet Services ───────────────────────────────────────────────────────────
function ServicesTab({ services, onServicesChange, pipelines }) {
  const [modal,   setModal]   = useState(null);
  const [form,    setForm]    = useState({});
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [confirm, setConfirm] = useState(null);

  const openCreate = () => { setForm({ name: '', pipeline_ids: [] }); setError(''); setModal({ mode: 'create' }); };
  const openEdit   = (svc) => { setForm({ name: svc.name, pipeline_ids: [...(svc.pipeline_ids || [])] }); setError(''); setModal({ mode: 'edit', svc }); };

  const togglePipeline = (id) => setForm(f => ({
    ...f,
    pipeline_ids: f.pipeline_ids.includes(id)
      ? f.pipeline_ids.filter(p => p !== id)
      : [...f.pipeline_ids, id],
  }));

  const handleSave = async () => {
    setError('');
    if (!form.name?.trim()) { setError('Nom requis'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), pipeline_ids: form.pipeline_ids };
      if (modal.mode === 'create') await api.createService(payload);
      else await api.updateService(modal.svc.id, payload);
      setModal(null); onServicesChange();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (svc) => {
    try { await api.deleteService(svc.id); setConfirm(null); onServicesChange(); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">{services.length} service{services.length !== 1 ? 's' : ''}</span>
        <button className="adm-btn-primary" onClick={openCreate}>+ Nouveau service</button>
      </div>

      <div className="adm-cards">
        {services.map(svc => (
          <div key={svc.id} className="adm-service-card">
            <div className="adm-service-card-header">
              <span className="adm-service-icon">🏢</span>
              <span className="adm-service-name">{svc.name}</span>
              <div className="adm-service-actions">
                <button className="adm-btn-icon" onClick={() => openEdit(svc)}>✏</button>
                <button className="adm-btn-icon adm-btn-danger" onClick={() => setConfirm(svc)}>🗑</button>
              </div>
            </div>
            {(svc.users || []).length > 0 && (
              <div className="adm-service-users">
                <span className="adm-service-section-label">👥 {svc.users_count} utilisateur{svc.users_count !== 1 ? 's' : ''}</span>
                <div className="adm-service-user-list">
                  {(svc.users || []).slice(0, 3).map(u => (
                    <span key={u.id} className="adm-service-user-chip">
                      {(u.first_name || u.last_name) ? `${u.first_name} ${u.last_name}`.trim() : u.login}
                    </span>
                  ))}
                  {(svc.users || []).length > 3 && (
                    <span className="adm-service-user-chip adm-chip-more">+{svc.users.length - 3}</span>
                  )}
                </div>
              </div>
            )}
            <div className="adm-service-pipelines">
              {(svc.pipeline_ids || []).length === 0
                ? <span className="adm-no-pipelines">Aucun pipeline assigné</span>
                : (svc.pipeline_ids || []).map(pid => {
                    const p = pipelines.find(x => x.id === pid);
                    return <span key={pid} className="adm-pipeline-tag">{p?.name || pid}</span>;
                  })
              }
            </div>
            <div className="adm-service-footer">Créé le {svc.created_at?.slice(0, 10)}</div>
          </div>
        ))}
        {services.length === 0 && <div className="adm-empty-cards">Aucun service créé</div>}
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouveau service' : `Modifier ${modal.svc.name}`} onClose={() => setModal(null)}>
          <div className="adm-form">
            <label>Nom du service</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Marketing, RH, IT…" />
            <label>Pipelines autorisés</label>
            {pipelines.length === 0
              ? <p className="adm-hint-block">Aucun pipeline disponible — créez-en dans l'onglet Pipelines.</p>
              : (
                <div className="adm-pipeline-checkboxes">
                  {pipelines.map(p => (
                    <label key={p.id} className="adm-checkbox-row">
                      <input type="checkbox" checked={form.pipeline_ids.includes(p.id)} onChange={() => togglePipeline(p.id)} />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              )
            }
            {error && <div className="adm-form-error">⚠ {error}</div>}
            <div className="adm-form-actions">
              <button className="adm-btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button className="adm-btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title="Confirmer la suppression" onClose={() => setConfirm(null)}>
          <p className="adm-confirm-text">Supprimer le service <strong>{confirm.name}</strong> ?</p>
          <div className="adm-form-actions">
            <button className="adm-btn-ghost" onClick={() => setConfirm(null)}>Annuler</button>
            <button className="adm-btn-danger-solid" onClick={() => handleDelete(confirm)}>Supprimer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Onglet Pipelines ──────────────────────────────────────────────────────────
function PipelinesTab({ pipelines, onPipelinesChange }) {
  const [editorState, setEditorState] = useState(null); // null | { mode: 'create' | 'edit', pipeline? }
  const [confirm,     setConfirm]     = useState(null);

  // PipelineEditor attend un "group" avec { id?, name, nodes, models }
  const openCreate = () => setEditorState({ mode: 'create', pipeline: {} });
  const openEdit   = (p) => setEditorState({ mode: 'edit',   pipeline: p });

  const handleSave = (updated, isNew) => {
    if (isNew) setEditorState(null);
    onPipelinesChange();
  };

  const handleDelete = async (pipeline) => {
    try {
      await apiFetch(ROUTES.groups.delete(pipeline.id), { method: 'DELETE' });
      setConfirm(null);
      onPipelinesChange();
    } catch (e) { console.error(e); }
  };

  // Résumé des modèles d'un pipeline
  const modelsSummary = (p) => {
    const models = p.models || (p.nodes || []).map(n => n.model).filter(Boolean);
    if (!models.length) return '—';
    if (models.length === 1) return models[0].split('/')[1] || models[0];
    return `${models[0].split('/')[1] || models[0]} +${models.length - 1}`;
  };

  // Si l'éditeur est ouvert, on le montre en plein écran (overlay)
  if (editorState) {
    return (
      <PipelineEditor
        group={editorState.pipeline}
        onSave={handleSave}
        onClose={() => setEditorState(null)}
      />
    );
  }

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">{pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''}</span>
        <button className="adm-btn-primary" onClick={openCreate}>+ Nouveau pipeline</button>
      </div>

      <table className="adm-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Modèles</th>
            <th>Nœuds</th>
            <th>Créé le</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pipelines.map(p => (
            <tr key={p.id}>
              <td>
                <div className="adm-pipeline-name">
                  <span className="adm-pipeline-icon">⚡</span>
                  <span>{p.name || <em className="adm-muted">Sans nom</em>}</span>
                </div>
              </td>
              <td>
                <span className="adm-pipeline-tag adm-pipeline-tag-sm">{modelsSummary(p)}</span>
              </td>
              <td className="adm-cell-date">{(p.nodes || []).length} nœud{(p.nodes || []).length !== 1 ? 's' : ''}</td>
              <td className="adm-cell-date">{p.created_at?.slice(0, 10) || '—'}</td>
              <td className="adm-cell-actions">
                <button className="adm-btn-icon" title="Éditer dans l'éditeur nodal" onClick={() => openEdit(p)}>✏ Éditer</button>
                <button className="adm-btn-icon adm-btn-danger" onClick={() => setConfirm(p)}>🗑</button>
              </td>
            </tr>
          ))}
          {pipelines.length === 0 && (
            <tr>
              <td colSpan={5} className="adm-empty">
                <div className="adm-empty-pipeline">
                  <span style={{ fontSize: 32 }}>⚡</span>
                  <p>Aucun pipeline créé</p>
                  <button className="adm-btn-primary" onClick={openCreate}>Créer le premier pipeline</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {confirm && (
        <Modal title="Confirmer la suppression" onClose={() => setConfirm(null)}>
          <p className="adm-confirm-text">Supprimer le pipeline <strong>{confirm.name}</strong> ? Les services qui l'utilisent perdront cet accès.</p>
          <div className="adm-form-actions">
            <button className="adm-btn-ghost" onClick={() => setConfirm(null)}>Annuler</button>
            <button className="adm-btn-danger-solid" onClick={() => handleDelete(confirm)}>Supprimer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ── Onglet Droits ─────────────────────────────────────────────────────────────
function PermissionsTab({ services, pipelines }) {
  const [permList, setPermList] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listPermissions();
      setPermList(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('PermissionsTab load error:', e);
      setPermList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const isGranted = (subject, resource, action) =>
    permList.some(p => p.subject === subject && p.resource === resource && p.action === action && p.granted);

  const toggle = async (subject, resource, action, currentlyGranted) => {
    const key = `${subject}|${resource}|${action}`;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      if (currentlyGranted) {
        const perm = permList.find(p => p.subject === subject && p.resource === resource && p.action === action && p.granted);
        if (perm) await api.revokePermission(perm.id);
      } else {
        await api.grantPermission(subject, resource, action, true);
      }
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const pipelineResources = pipelines.map(p => ({ id: `pipeline:${p.id}`, label: p.name, type: 'pipeline' }));
  const allResources = [
    ...pipelineResources,
    { id: 'conversation:*', label: 'Conversations', type: 'conversation' },
  ];
  const serviceSubjects = services.map(s => ({ id: `service:${s.id}`, label: s.name }));

  const actionColor = { use: '#b8941f', edit: '#cc9944' };

  if (loading) return <div className="adm-loading">Chargement…</div>;

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">Matrice de droits — Services × Ressources</span>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>
          Les admins ont accès à tout par défaut. Ces règles s'appliquent aux utilisateurs non-admin.
        </span>
      </div>

      {serviceSubjects.length === 0 ? (
        <div className="adm-empty">Aucun service créé — allez dans l'onglet Services.</div>
      ) : (
        <div className="adm-perm-matrix-wrap">
          <table className="adm-perm-matrix">
            <thead>
              <tr>
                <th className="adm-perm-subject-col">Service</th>
                {allResources.map(res => (
                  <th key={res.id} className="adm-perm-res-col">
                    <div className="adm-perm-res-label">
                      <span className="adm-perm-res-type">{res.type}</span>
                      <span className="adm-perm-res-name">{res.label}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {serviceSubjects.map(subj => (
                <tr key={subj.id}>
                  <td className="adm-perm-subject">
                    <span className="adm-perm-subject-icon">🏢</span>{subj.label}
                  </td>
                  {allResources.map(res => {
                    const actions = res.type === 'pipeline' ? ['use', 'edit'] : ['use'];
                    return (
                      <td key={res.id} className="adm-perm-cell">
                        <div className="adm-perm-actions">
                          {actions.map(action => {
                            const granted = isGranted(subj.id, res.id, action);
                            const key     = `${subj.id}|${res.id}|${action}`;
                            const busy    = saving[key];
                            return (
                              <button key={action}
                                className={`adm-perm-toggle ${granted ? 'granted' : 'denied'}`}
                                style={granted ? { borderColor: actionColor[action], color: actionColor[action] } : {}}
                                title={`${granted ? 'Révoquer' : 'Accorder'} : ${action}`}
                                onClick={() => toggle(subj.id, res.id, action, granted)}
                                disabled={busy}
                              >
                                {busy ? '…' : (granted ? '✓' : '✗')} {action}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="adm-perm-legend">
            <span style={{ color: '#b8941f' }}>✓ use</span> — voir et lancer
            &nbsp;·&nbsp;
            <span style={{ color: '#F59E0B' }}>✓ edit</span> — modifier dans l'éditeur
            &nbsp;·&nbsp;
            <span style={{ color: 'var(--dim)' }}>✗</span> — refusé
          </div>
        </div>
      )}
    </div>
  );
}

// ── Onglet Agents V3 ──────────────────────────────────────────────────────────
function AgentsTab() {
  const [agents,  setAgents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // null | { mode: 'create'|'edit', agent? }
  const [form,    setForm]    = useState({});
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [executions, setExecutions] = useState({}); // { agent_id: [...] }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiFetch(ROUTES.agents.list);
      const data = res && res.ok ? await res.json() : [];
      setAgents(Array.isArray(data) ? data : []);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const emptyForm = { name: '', description: '', trigger_type: 'manual', cron: '0 8 * * 1',
    notify_users: '', output_type: 'conversation' };

  const openCreate = () => { setForm(emptyForm); setError(''); setModal({ mode: 'create' }); };
  const openEdit   = (a) => {
    setForm({
      name: a.name, description: a.description,
      trigger_type: a.trigger?.type || 'manual',
      cron: a.trigger?.cron || '0 8 * * 1',
      notify_users: (a.output?.notify_users || []).join(', '),
      output_type: a.output?.type || 'conversation',
    });
    setError(''); setModal({ mode: 'edit', agent: a });
  };

  const handleSave = async () => {
    setError('');
    if (!form.name?.trim()) { setError('Nom requis'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        trigger: form.trigger_type === 'scheduled'
          ? { type: 'scheduled', cron: form.cron, timezone: 'Europe/Paris' }
          : form.trigger_type === 'webhook'
          ? { type: 'webhook', auth: 'bearer' }
          : { type: 'manual' },
        output: {
          type: form.output_type,
          notify_users: form.notify_users.split(',').map(s => s.trim()).filter(Boolean),
        },
        cog: modal.mode === 'edit' ? modal.agent.cog : {},
      };
      if (modal.mode === 'create') {
        await apiFetch(ROUTES.agents.create, { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await apiFetch(ROUTES.agents.update(modal.agent.agent_id), { method: 'PATCH', body: JSON.stringify(payload) });
      }
      setModal(null); load();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleTrigger = async (agent) => {
    try {
      const res = await apiFetch(ROUTES.agents.trigger(agent.agent_id), {
        method: 'POST', body: JSON.stringify({ user_input: '' }),
      });
      const data = res && res.ok ? await res.json() : {};
      alert(`✅ Agent déclenché — execution_id : ${data.execution_id}`);
      load();
    } catch(e) { alert(`Erreur : ${e.message}`); }
  };

  const handlePause  = async (a) => { await apiFetch(ROUTES.agents.pause(a.agent_id),  { method: 'POST' }); load(); };
  const handleResume = async (a) => { await apiFetch(ROUTES.agents.resume(a.agent_id), { method: 'POST' }); load(); };
  const handleDelete = async (a) => {
    if (!window.confirm(`Supprimer l'agent "${a.name}" ?`)) return;
    await apiFetch(ROUTES.agents.delete(a.agent_id), { method: 'DELETE' });
    load();
  };

  const loadExecutions = async (agentId) => {
    const res  = await apiFetch(ROUTES.agents.executions(agentId));
    const data = res && res.ok ? await res.json() : [];
    setExecutions(prev => ({ ...prev, [agentId]: data }));
  };

  const TRIGGER_LABELS = { manual: '🖐 Manuel', scheduled: '⏰ Planifié', webhook: '🔗 Webhook', rag_event: '📁 RAG' };
  const STATUS_BADGES  = { active: '🟢 Actif', paused: '🟡 Pause', error: '🔴 Erreur' };
  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso.slice(0, 16); }
  };

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">{agents.length} agent{agents.length !== 1 ? 's' : ''} déployé{agents.length !== 1 ? 's' : ''}</span>
        <button className="adm-btn-primary" onClick={openCreate}>+ Nouvel agent</button>
      </div>

      {loading ? <div className="adm-loading">Chargement…</div> : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Statut</th>
              <th>Déclencheur</th>
              <th>Exécutions</th>
              <th>Dernière exec</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.agent_id}>
                <td>
                  <div className="adm-agent-name">{a.name}</div>
                  {a.description && <div className="adm-cell-date">{a.description}</div>}
                </td>
                <td><span className="adm-badge badge-user">{STATUS_BADGES[a.status] || a.status}</span></td>
                <td>
                  {TRIGGER_LABELS[a.trigger?.type] || a.trigger?.type || '—'}
                  {a.trigger?.cron && <span className="adm-cell-date"> {a.trigger.cron}</span>}
                </td>
                <td className="adm-cell-date">{a.run_count || 0}</td>
                <td className="adm-cell-date">{fmtDate(a.last_run_at)}</td>
                <td className="adm-cell-actions">
                  <button className="adm-btn-icon" title="Déclencher" onClick={() => handleTrigger(a)}>▶</button>
                  {a.status === 'active'
                    ? <button className="adm-btn-icon" title="Pause" onClick={() => handlePause(a)}>⏸</button>
                    : <button className="adm-btn-icon" title="Reprendre" onClick={() => handleResume(a)}>▶▶</button>
                  }
                  <button className="adm-btn-icon" title="Éditer" onClick={() => openEdit(a)}>✏</button>
                  <button className="adm-btn-icon adm-btn-danger" title="Supprimer" onClick={() => handleDelete(a)}>🗑</button>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr><td colSpan={6} className="adm-empty">
                Aucun agent déployé — créez votre premier agent ou importez depuis le Catalogue.
              </td></tr>
            )}
          </tbody>
        </table>
      )}

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Nouvel agent' : `Modifier ${modal.agent.name}`}
          onClose={() => setModal(null)}
        >
          <div className="adm-form">
            <label>Nom de l'agent</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Veille concurrentielle" />
            <label>Description</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Analyse hebdomadaire de la concurrence" />
            <label>Déclencheur</label>
            <select value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}>
              <option value="manual">🖐 Manuel</option>
              <option value="scheduled">⏰ Planifié (cron)</option>
              <option value="webhook">🔗 Webhook entrant</option>
              <option value="rag_event">📁 Événement RAG</option>
            </select>
            {form.trigger_type === 'scheduled' && (
              <>
                <label>Expression cron</label>
                <input value={form.cron} onChange={e => setForm(f => ({ ...f, cron: e.target.value }))}
                  placeholder="0 8 * * 1  (lundi 8h)" />
                <div className="adm-hint-block">Format : min heure jour mois jour_semaine</div>
              </>
            )}
            <label>Notifier les utilisateurs (logins, virgule)</label>
            <input value={form.notify_users} onChange={e => setForm(f => ({ ...f, notify_users: e.target.value }))}
              placeholder="admin, direction" />
            {error && <div className="adm-form-error">⚠ {error}</div>}
            <div className="adm-form-actions">
              <button className="adm-btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button className="adm-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Onglet Catalogue agents métier ────────────────────────────────────────────
function CatalogTab() {
  const [templates, setTemplates] = useState([]);
  const [domains,   setDomains]   = useState([]);
  const [domain,    setDomain]    = useState('');
  const [loading,   setLoading]   = useState(true);
  const [deploying, setDeploying] = useState(null); // template en cours de déploiement
  const [preview,   setPreview]   = useState(null);

  const DOMAIN_ICONS = {
    juridique: '⚖️', fiscal: '💰', rh: '👥', veille: '🔭',
    medical: '🏥', marketing: '📈', sales: '🎯', communication: '📰',
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, dRes] = await Promise.all([
        apiFetch(domain ? ROUTES.catalog.byDomain(domain) : ROUTES.catalog.agents),
        apiFetch(ROUTES.catalog.domains),
      ]);
      const t = tRes && tRes.ok ? await tRes.json() : [];
      const d = dRes && dRes.ok ? await dRes.json() : [];
      setTemplates(Array.isArray(t) ? t : []);
      setDomains(Array.isArray(d) ? d : []);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [domain]);

  useEffect(() => { load(); }, [load]);

  const handleDeploy = async (template) => {
    const name = window.prompt(`Nom de l'agent à créer :`, template.name);
    if (!name) return;
    setDeploying(template.id);
    try {
      const payload = {
        name,
        description: template.description,
        cog: template.cog,
        trigger: template.trigger_suggestion || { type: 'manual' },
        output: { type: 'conversation', notify_users: [] },
      };
      const res = await apiFetch(ROUTES.agents.create, {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (res && res.ok) {
        alert(`✅ Agent "${name}" déployé avec succès !`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Erreur : ${err.detail || 'Déploiement échoué'}`);
      }
    } catch(e) { alert(`Erreur : ${e.message}`); }
    finally { setDeploying(null); }
  };

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">{templates.length} template{templates.length !== 1 ? 's' : ''}</span>
        <div className="adm-domain-filter">
          <button className={`adm-domain-btn${!domain ? ' active' : ''}`} onClick={() => setDomain('')}>Tous</button>
          {domains.map(d => (
            <button key={d} className={`adm-domain-btn${domain === d ? ' active' : ''}`} onClick={() => setDomain(d)}>
              {DOMAIN_ICONS[d] || '📦'} {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="adm-loading">Chargement du catalogue…</div> : (
        <div className="adm-catalog-grid">
          {templates.map(t => (
            <div key={t.id} className="adm-catalog-card">
              <div className="adm-catalog-icon">{t.icon || DOMAIN_ICONS[t.domain] || '📦'}</div>
              <div className="adm-catalog-name">{t.name}</div>
              <div className="adm-catalog-domain">{t.domain}</div>
              <div className="adm-catalog-desc">{t.description}</div>
              <div className="adm-catalog-meta">
                <span title="Coût estimé">💰 {t.estimated_cost}</span>
                <span title="Durée estimée">⏱ {t.estimated_duration}</span>
                <span title="Nœuds">⬡ {t.nodes_count} nœud{t.nodes_count !== 1 ? 's' : ''}</span>
              </div>
              <div className="adm-catalog-tags">
                {(t.tags || []).slice(0, 4).map(tag => (
                  <span key={tag} className="adm-tag" style={{ background: 'rgba(184,148,31,.08)', color: '#d4aa2a', borderColor: 'rgba(184,148,31,.25)' }}>{tag}</span>
                ))}
              </div>
              <div className="adm-catalog-actions">
                <button className="adm-btn-ghost adm-btn-sm" onClick={() => setPreview(t)}>Aperçu</button>
                <button className="adm-btn-primary adm-btn-sm"
                  disabled={deploying === t.id}
                  onClick={() => handleDeploy(t)}>
                  {deploying === t.id ? 'Déploiement…' : 'Déployer'}
                </button>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <div className="adm-empty-cards">Aucun template pour ce domaine</div>
          )}
        </div>
      )}

      {preview && (
        <Modal title={`Aperçu — ${preview.name}`} onClose={() => setPreview(null)}>
          <div className="adm-catalog-preview">
            <p className="adm-catalog-desc">{preview.description}</p>
            <div className="adm-catalog-meta">
              <span>💰 {preview.estimated_cost}</span>
              <span>⏱ {preview.estimated_duration}</span>
              <span>🤖 {(preview.recommended_models || []).join(', ')}</span>
            </div>
            <h4 style={{ marginTop: 12, fontSize: 12, color: 'var(--color-gold-dim)', textTransform: 'uppercase' }}>Nœuds du pipeline</h4>
            {(preview.cog?.nodes || []).map(n => (
              <div key={n.id} className="adm-preview-node">
                <span className="adm-preview-node-id">{n.id}</span>
                <span className="adm-preview-node-model">{(n.model || '').split('/').pop()}</span>
                <span className="adm-preview-node-role">{n.role}</span>
              </div>
            ))}
            {(preview.cog?.nodes || []).length === 0 && <p className="adm-hint-block">Aucun nœud défini</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Onglet Modèles ────────────────────────────────────────────────────────────
function ModelsTab() {
  const [allModels,     setAllModels]     = useState([]);
  const [allowedIds,    setAllowedIds]    = useState(new Set());
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [filterTag,     setFilterTag]     = useState('');
  const [saving,        setSaving]        = useState({});
  const [error,         setError]         = useState('');
  const [sortColumn,    setSortColumn]    = useState('name');
  const [sortDir,       setSortDir]       = useState('asc');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(ROUTES.models.list);
      const data = res && res.ok ? await res.json() : {};
      setAllModels(data.models || []);
      setAllowedIds(new Set(data.allowed_ids || []));
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (model, currentlyAllowed) => {
    setSaving(s => ({ ...s, [model.id]: true }));
    try {
      if (currentlyAllowed) {
        await apiFetch(ROUTES.models.allowedDelete(encodeURIComponent(model.id)), { method: 'DELETE' });
        setAllowedIds(prev => { const s = new Set(prev); s.delete(model.id); return s; });
      } else {
        await apiFetch(ROUTES.models.allowed, {
          method: 'POST',
          body: JSON.stringify({ model_id: model.id, name: model.name,
                                 cost_stars: model.cost_stars, tags: model.tags }),
        });
        setAllowedIds(prev => new Set([...prev, model.id]));
      }
    } catch(e) {
      // Afficher l'alerte si modèle en cours d'utilisation
      alert(e.message || 'Erreur');
    }
    setSaving(s => ({ ...s, [model.id]: false }));
  };

  const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐'];
  const TAG_COLORS = { code:'#b8941f', vision:'#d4aa2a', reasoning:'#cc9944',
                       fast:'#6dbb87', chat:'#7a7570', free:'#cc9944' };

  const allTags = [...new Set(allModels.flatMap(m => m.tags || []))].sort();
  const filtered = allModels.filter(m => {
    const q = search.toLowerCase();
    const matchQ = !q || m.id.toLowerCase().includes(q) || (m.name||'').toLowerCase().includes(q);
    const matchT = !filterTag || (m.tags||[]).includes(filterTag);
    return matchQ && matchT;
  });

  const toggleSort = (col) => {
    if (sortColumn === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDir('asc'); }
  };
  const sortIndicator = (col) => sortColumn === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';

  const sortedModels = [...filtered].sort((a, b) => {
    let va, vb;
    if (sortColumn === 'cost') {
      va = parseFloat(a.pricing?.prompt || a.cost_in || 0);
      vb = parseFloat(b.pricing?.prompt || b.cost_in || 0);
    } else if (sortColumn === 'context') {
      va = parseInt(a.context_length || 0);
      vb = parseInt(b.context_length || 0);
    } else {
      va = (a.name || a.id || '').toLowerCase();
      vb = (b.name || b.id || '').toLowerCase();
    }
    return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  if (loading) return <div className="adm-loading">Chargement des modèles OpenRouter…</div>;

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">{allowedIds.size} modèle{allowedIds.size !== 1 ? 's' : ''} autorisé{allowedIds.size !== 1 ? 's' : ''} / {allModels.length} disponibles</span>
        <input className="adm-search" placeholder="Rechercher…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <select className="adm-select-sm" value={filterTag} onChange={e => setFilterTag(e.target.value)}>
          <option value="">Tous les tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && <div className="adm-error">{error}</div>}

      {allowedIds.size === 0 && (
        <div className="adm-banner-warn">
          ⚠ Aucun modèle autorisé — tous les modèles OpenRouter ({allModels.length}) sont
          actuellement visibles dans l'éditeur de pipelines.
          Cochez les modèles à autoriser pour restreindre la liste.
        </div>
      )}
      <div className="adm-hint-block">
        Cochez les modèles qui apparaîtront dans l'éditeur de pipelines.
        Un modèle utilisé dans un pipeline actif ne peut pas être révoqué.
      </div>

      <table className="adm-table adm-models-table">
        <thead>
          <tr>
            <th style={{width:40}}>✓</th>
            <th className="sortable" onClick={() => toggleSort('name')}>Modèle{sortIndicator('name')}</th>
            <th>Tags</th>
            <th className="sortable" onClick={() => toggleSort('cost')}>Coût{sortIndicator('cost')}</th>
            <th className="sortable" onClick={() => toggleSort('context')}>Contexte{sortIndicator('context')}</th>
          </tr>
        </thead>
        <tbody>
          {sortedModels.map(model => {
            const allowed = allowedIds.has(model.id);
            const busy    = saving[model.id];
            return (
              <tr key={model.id} className={allowed ? 'adm-row-allowed' : ''}>
                <td>
                  <label className="pe-toggle" title={allowed ? 'Révoquer' : 'Autoriser'}>
                    <input type="checkbox" checked={allowed} disabled={busy}
                      onChange={() => toggle(model, allowed)} />
                    <span className="pe-toggle-track" />
                  </label>
                </td>
                <td>
                  <div className="adm-model-id">{model.id}</div>
                  {model.description && (
                    <div className="adm-model-desc">{model.description.slice(0,100)}{model.description.length>100?'…':''}</div>
                  )}
                </td>
                <td>
                  <div className="adm-tags">
                    {(model.tags||[]).map(t => (
                      <span key={t} className="adm-tag"
                        style={{ background: (TAG_COLORS[t]||'#64748B')+'22',
                                 color: TAG_COLORS[t]||'#64748B',
                                 borderColor: (TAG_COLORS[t]||'#64748B')+'44' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="adm-model-cost">
                  {model.cost_stars > 0 ? STARS[model.cost_stars] : <span style={{color:'#6dbb87'}}>Gratuit</span>}
                  {model.cost_in > 0 && (
                    <span className="adm-cost-detail">↑{model.cost_in}$ ↓{model.cost_out}$/M</span>
                  )}
                </td>
                <td className="adm-model-ctx">
                  {model.context_length ? `${Math.round(model.context_length/1000)}k` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Gestionnaire Ollama — chips + layout deux colonnes ────────────────────────
function OllamaManager({ localInfo, onRefresh }) {
  const [catalog,       setCatalog]       = useState([]);
  const [installedModels, setInstalledModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [pulling,       setPulling]       = useState({});

  const loadInstalledModels = useCallback(async () => {
    try {
      const res = await apiFetch(ROUTES.local.models);
      const data = res && res.ok ? await res.json() : {};
      setInstalledModels(data.models || []);
    } catch (e) { console.error(e); }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await apiFetch(ROUTES.local.catalog);
      const data = res && res.ok ? await res.json() : [];
      setCatalog(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadInstalledModels();
    loadCatalog();
  }, [loadInstalledModels, loadCatalog]);

  const installModel = async (modelId) => {
    setPulling(prev => ({ ...prev, [modelId]: { progress: 0, downloaded_gb: 0, total_gb: 0 } }));
    try {
      const response = await apiFetch(ROUTES.local.pull, {
        method: 'POST',
        body: JSON.stringify({ model: modelId }),
      });
      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status === 'done') {
              setPulling(prev => { const n = { ...prev }; delete n[modelId]; return n; });
              loadInstalledModels();
              loadCatalog();
              onRefresh();
              return;
            }
            if (data.status === 'error') {
              setPulling(prev => { const n = { ...prev }; delete n[modelId]; return n; });
              return;
            }
            setPulling(prev => ({
              ...prev,
              [modelId]: { progress: data.progress, downloaded_gb: data.downloaded_gb, total_gb: data.total_gb },
            }));
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setPulling(prev => { const n = { ...prev }; delete n[modelId]; return n; });
    }
  };

  const uninstallModel = async (modelName) => {
    if (!window.confirm(`Désinstaller ${modelName} ?`)) return;
    try {
      await apiFetch(ROUTES.local.delete(encodeURIComponent(modelName)), { method: 'DELETE' });
      setSelectedModel(prev => prev ? { ...prev, installed: false } : null);
      loadInstalledModels();
      loadCatalog();
      onRefresh();
    } catch (e) { alert(`Erreur : ${e.message}`); }
  };

  if (!localInfo) return null;

  return (
    <div style={{ marginTop: 28 }}>
      {/* En-tête avec statut Ollama */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--dim)',
                     textTransform: 'uppercase', letterSpacing: '.5px', margin: 0 }}>
          🖥 Modèles locaux (Ollama)
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ fontFamily: 'monospace', color: 'var(--dim)', fontSize: 11 }}>
            {localInfo.url || 'localhost:11434'}
          </span>
          {localInfo.available
            ? <span style={{ color: '#22C55E', fontWeight: 600 }}>🟢 Disponible</span>
            : <span style={{ color: '#EF4444', fontWeight: 600 }}>🔴 Non disponible</span>}
        </div>
      </div>

      {!localInfo.available ? (
        <div className="adm-empty">
          Ollama n'est pas détecté. Installez-le sur <strong>ollama.ai</strong> puis lancez{' '}
          <code>ollama serve</code>.
        </div>
      ) : (
        <>
          {/* ── Chips modèles installés ── */}
          <div className="ollama-installed-chips">
            <span className="ollama-section-label">Modèles installés</span>
            <div className="ollama-chips">
              {installedModels.map(m => {
                const catalogEntry = catalog.find(c => c.id === m.name);
                const model = catalogEntry || { id: m.name, name: m.name, size_gb: (m.size / 1e9).toFixed(1), tags: [], installed: true };
                return (
                  <button
                    key={m.name}
                    className={`ollama-chip${selectedModel?.id === m.name ? ' active' : ''}`}
                    onClick={() => setSelectedModel(model)}
                  >
                    {m.name}
                  </button>
                );
              })}
              {installedModels.length === 0 && (
                <span className="ollama-no-models">Aucun modèle installé</span>
              )}
            </div>
          </div>

          {/* ── Layout deux colonnes : liste + détail ── */}
          <div className="ollama-manager-layout">
            {/* Colonne gauche — catalogue */}
            <div className="ollama-catalog-list">
              <span className="ollama-section-label">Liste des modèles</span>
              {catalog.map(model => {
                const isPulling = !!pulling[model.id];
                const pullData  = pulling[model.id];
                return (
                  <div
                    key={model.id}
                    className={`ollama-catalog-row${selectedModel?.id === model.id ? ' selected' : ''}`}
                    onClick={() => setSelectedModel(model)}
                  >
                    <div className="ollama-row-main">
                      <span className="ollama-row-name">{model.name}</span>
                      <span className="ollama-row-size">{model.size_gb} GB</span>
                      {model.installed ? (
                        <span className="ollama-row-installed">✓ Installé</span>
                      ) : isPulling ? (
                        <span className="ollama-row-pulling">En cours…</span>
                      ) : (
                        <button
                          className="ollama-btn-install"
                          onClick={e => { e.stopPropagation(); installModel(model.id); }}
                        >
                          ⬇ Installer
                        </button>
                      )}
                    </div>
                    {isPulling && (
                      <div className="ollama-progress">
                        <div className="ollama-progress-bar">
                          <div className="ollama-progress-fill" style={{ width: `${pullData.progress}%` }} />
                        </div>
                        <span className="ollama-progress-label">
                          {pullData.progress}% — {pullData.downloaded_gb} / {pullData.total_gb} GB
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Colonne droite — panel détail */}
            {selectedModel && (
              <div className="ollama-detail-panel">
                <h3 className="ollama-detail-name">{selectedModel.name || selectedModel.id}</h3>
                {selectedModel.description && (
                  <p className="ollama-detail-desc">{selectedModel.description}</p>
                )}
                <div className="ollama-detail-meta">
                  Taille : {selectedModel.size_gb} GB
                </div>
                {selectedModel.tags?.length > 0 && (
                  <div className="ollama-detail-tags">
                    {selectedModel.tags.map(t => (
                      <span key={t} className="ollama-tag">{t}</span>
                    ))}
                  </div>
                )}
                <div className="ollama-detail-actions">
                  {selectedModel.installed ? (
                    <button className="ollama-btn-delete" onClick={() => uninstallModel(selectedModel.id)}>
                      🗑 Supprimer
                    </button>
                  ) : (
                    <button
                      className="ollama-btn-install-lg"
                      disabled={!!pulling[selectedModel.id]}
                      onClick={() => installModel(selectedModel.id)}
                    >
                      {pulling[selectedModel.id]
                        ? `${pulling[selectedModel.id].progress}%…`
                        : '⬇ Installer'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Widget Scoring qualité ────────────────────────────────────────────────────
function ScoringWidget() {
  const [summary, setSummary] = useState([]);
  const [days,    setDays]    = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${ROUTES.scores?.summary || '/api/v1/scores/summary'}?days=${days}`);
      if (res?.ok) setSummary(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const fmt = (v) => v != null ? `${v.toFixed(1)}/10` : '—';

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--dim)',
                     textTransform: 'uppercase', letterSpacing: '.5px', margin: 0 }}>
          ⭐ Scoring qualité LLM
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90].map(d => (
            <button key={d}
              onClick={() => setDays(d)}
              className={days === d ? 'adm-btn-primary adm-btn-sm' : 'adm-btn-ghost adm-btn-sm'}
              style={{ padding: '3px 10px', fontSize: 11 }}>
              {d}j
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="adm-loading" style={{ padding: '16px 0' }}>Chargement…</div>
      ) : summary.length === 0 ? (
        <div className="adm-empty">Aucun score disponible pour cette période.</div>
      ) : (
        <table className="adm-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Modèle</th>
              <th style={{ textAlign: 'center' }}>Pertinence</th>
              <th style={{ textAlign: 'center' }}>Précision</th>
              <th style={{ textAlign: 'center' }}>Format</th>
              <th style={{ textAlign: 'center' }}>Global</th>
              <th style={{ textAlign: 'center' }}>N</th>
            </tr>
          </thead>
          <tbody>
            {summary.map(s => (
              <tr key={s.model}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {s.model_short || s.model}
                </td>
                <td style={{ textAlign: 'center' }}>{fmt(s.relevance)}</td>
                <td style={{ textAlign: 'center' }}>{fmt(s.accuracy)}</td>
                <td style={{ textAlign: 'center' }}>{fmt(s.format)}</td>
                <td style={{ textAlign: 'center', fontWeight: 700,
                             color: s.overall >= 7 ? 'var(--ok)' : s.overall >= 5 ? 'var(--warn)' : 'var(--danger)' }}>
                  {fmt(s.overall)}
                </td>
                <td style={{ textAlign: 'center', color: 'var(--dim)' }}>{s.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Onglet État Modèles ───────────────────────────────────────────────────────
function ModelStatusTab() {
  const [status,    setStatus]    = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, incRes] = await Promise.all([
        apiFetch(ROUTES.models.status),
        apiFetch(ROUTES.admin.incidents),
      ]);
      const s   = sRes   && sRes.ok   ? await sRes.json()   : [];
      const inc = incRes && incRes.ok ? await incRes.json() : [];
      setStatus(Array.isArray(s) ? s : []);
      setIncidents(Array.isArray(inc) ? inc : []);
      if (s?.length) setCheckedAt(s[0]?.last_checked);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐'];
  const TAG_COLORS = {
    reasoning: '#d4aa2a', code: '#b8941f', fast: '#6dbb87',
    vision: '#cc9944', chat: '#7a7570', european: '#cc9944',
    rgpd: '#cc9944', analysis: '#d4aa2a', 'long-context': '#b8941f',
  };

  const statusIcon = (node) => {
    if (!node.available) return <span title="Indisponible">🔴</span>;
    if (node.endpoints_count === 1) return <span title="Dégradé (1 endpoint)">🟡</span>;
    if (node.endpoints_count >= 0) return <span title={`${node.endpoints_count} endpoints`}>🟢</span>;
    return <span title="Statut inconnu">⚪</span>;
  };

  // Incidents des 7 derniers jours
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 19);
  const recentIncidents = incidents
    .filter(i => (i.timestamp || '') >= sevenDaysAgo)
    .slice(-20)
    .reverse();

  const fmtTs = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts + 'Z');
      return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
  };

  const short = (m) => (m || '').split('/').pop();

  if (loading) return <div className="adm-loading">Vérification des modèles…</div>;

  const ok    = status.filter(s => s.available).length;
  const total = status.length;

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">
          🟢 État des modèles en production —{' '}
          <span style={{ color: ok < total ? '#F59E0B' : '#22C55E' }}>{ok}/{total} disponibles</span>
        </span>
        {checkedAt && (
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            Dernière vérification : {checkedAt.replace('T', ' ')}
          </span>
        )}
        <button className="adm-btn-ghost" onClick={load}>↺ Actualiser</button>
      </div>

      <table className="adm-table">
        <thead>
          <tr>
            <th>Modèle</th>
            <th style={{ textAlign: 'center' }}>Statut</th>
            <th style={{ textAlign: 'center' }}>Endpoints</th>
            <th style={{ textAlign: 'center' }}>Tier</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {status.map(s => (
            <tr key={s.model}>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{short(s.model)}</td>
              <td style={{ textAlign: 'center', fontSize: 16 }}>{statusIcon(s)}</td>
              <td style={{ textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
                {s.endpoints_count >= 0 ? s.endpoints_count : '—'}
              </td>
              <td style={{ textAlign: 'center' }}>{STARS[s.cost_tier] || '—'}</td>
              <td>
                <div className="adm-tags">
                  {(s.tags || []).map(t => (
                    <span key={t} className="adm-tag"
                      style={{ background: (TAG_COLORS[t] || '#64748B') + '22',
                               color: TAG_COLORS[t] || '#64748B',
                               borderColor: (TAG_COLORS[t] || '#64748B') + '44' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 28 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--dim)',
                     textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 10px' }}>
          ⚠ Incidents de fallback — 7 derniers jours ({recentIncidents.length})
        </h3>

        {recentIncidents.length === 0 ? (
          <div className="adm-empty">Aucun incident récent — tous les modèles répondent normalement.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Modèle original</th>
                <th>Fallback utilisé</th>
                <th>Node</th>
                <th>Raison</th>
              </tr>
            </thead>
            <tbody>
              {recentIncidents.map((inc, i) => (
                <tr key={i}>
                  <td className="adm-cell-date">{fmtTs(inc.timestamp)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#EF4444' }}>
                    {short(inc.original_model)}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#22C55E' }}>
                    {short(inc.fallback_model)}
                  </td>
                  <td style={{ color: 'var(--dim)', fontSize: 11 }}>{inc.node_id || '—'}</td>
                  <td>
                    <span className="adm-tag" style={{
                      background: 'rgba(239,68,68,.12)',
                      color: '#EF4444',
                      borderColor: 'rgba(239,68,68,.3)',
                    }}>
                      {inc.reason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ScoringWidget />

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--dim)' }}>
        🟢 Disponible &nbsp;·&nbsp; 🟡 Dégradé (1 endpoint) &nbsp;·&nbsp; 🔴 Indisponible &nbsp;·&nbsp;
        ⚪ Statut inconnu (erreur réseau)
      </div>
    </div>
  );
}

// ── Onglet Local (Ollama) ─────────────────────────────────────────────────────
function LocalTab() {
  const [localInfo, setLocalInfo] = useState(null);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(ROUTES.local.models).catch(() => null);
      const loc = res && res.ok ? await res.json() : null;
      setLocalInfo(loc);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="adm-loading">Chargement Ollama…</div>;

  return (
    <div className="adm-section">
      <OllamaManager localInfo={localInfo} onRefresh={load} />
    </div>
  );
}

// ── Onglet Tokens Dashboard ───────────────────────────────────────────────────
function DashboardTokensTab() {
  const [tokens,  setTokens]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [label,   setLabel]   = useState('');
  const [expiry,  setExpiry]  = useState('90');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [copied,  setCopied]  = useState(null);

  const FRONTEND_BASE = window.location.origin;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(ROUTES.admin.dashboardTokens);
      setTokens(res && res.ok ? await res.json() : []);
    }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!label.trim()) { setError('Label requis'); return; }
    setError(''); setSaving(true);
    try {
      const body = { label: label.trim() };
      if (expiry !== '0') body.expires_days = parseInt(expiry, 10);
      await apiFetch(ROUTES.admin.dashboardToken, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLabel('');
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleRevoke = async (token) => {
    if (!window.confirm('Révoquer ce lien ? Il ne sera plus accessible.')) return;
    try {
      await apiFetch(ROUTES.admin.dashboardTokenDelete(token), { method: 'DELETE' });
      load();
    } catch (e) { console.error(e); }
  };

  const handleCopy = (token) => {
    const url = `${FRONTEND_BASE}/dashboard/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token);
      setTimeout(() => setCopied(t => t === token ? null : t), 2000);
    });
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const isExpired = (d) => d && new Date(d) < new Date();

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">Liens de partage — Tableau de bord</span>
      </div>

      <div className="adm-form" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, marginBottom: 8 }}>
        <input
          placeholder="Label (ex: COMEX Mars 2026)"
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          style={{ flex: '1 1 220px' }}
        />
        <select
          value={expiry}
          onChange={e => setExpiry(e.target.value)}
          style={{ flex: '0 0 160px' }}
        >
          <option value="30">Expire dans 30 j</option>
          <option value="90">Expire dans 90 j</option>
          <option value="365">Expire dans 1 an</option>
          <option value="0">Sans expiration</option>
        </select>
        <button className="adm-btn-primary" onClick={handleGenerate} disabled={saving}
                style={{ flex: '0 0 auto' }}>
          {saving ? '…' : '+ Générer le lien'}
        </button>
      </div>
      {error && <div className="adm-form-error" style={{ marginBottom: 8 }}>{error}</div>}

      {loading ? (
        <div className="adm-loading">Chargement…</div>
      ) : tokens.length === 0 ? (
        <div className="adm-empty">Aucun lien généré — utilisez le formulaire ci-dessus.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Créé le</th>
              <th>Expire le</th>
              <th>URL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map(t => {
              const expired = isExpired(t.expires_at);
              return (
                <tr key={t.token} style={expired ? { opacity: 0.5 } : {}}>
                  <td><strong>{t.label}</strong>{expired && <span className="adm-badge" style={{ marginLeft: 6, background: 'rgba(239,68,68,.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,.3)' }}>expiré</span>}</td>
                  <td className="adm-cell-date">{fmtDate(t.created_at)}</td>
                  <td className="adm-cell-date">{fmtDate(t.expires_at)}</td>
                  <td>
                    <code style={{ fontSize: 10, color: 'var(--dim)', wordBreak: 'break-all' }}>
                      /dashboard/{t.token.slice(0, 8)}…
                    </code>
                  </td>
                  <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="adm-btn-ghost"
                      onClick={() => handleCopy(t.token)}
                      style={copied === t.token ? { color: '#22C55E' } : {}}
                    >
                      {copied === t.token ? '✓ Copié' : '📋 Copier URL'}
                    </button>
                    <button className="adm-btn-danger-solid" onClick={() => handleRevoke(t.token)}>
                      Révoquer
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--dim)' }}>
        Le lien donne accès en lecture seule au tableau de bord, sans authentification.
        Partagez uniquement avec les destinataires autorisés.
      </div>
    </div>
  );
}

// ── Onglet RAG — délégué à RAGTab ────────────────────────────────────────────
// Voir frontend/src/components/AdminPanel/RAGTab.jsx


// ── Onglet Paramètres ─────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings,  setSettings]  = useState(null);
  const [form,      setForm]      = useState({});
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    apiFetch(ROUTES.admin.settings)
      .then(res => res && res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res?.status}`)))
      .then(s => { setSettings(s); setForm({ default_model: s.default_model, default_chairman: s.default_chairman }); })
      .catch(e => setError(e.message));
  }, []);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await apiFetch(ROUTES.admin.settings, { method: 'PUT', body: JSON.stringify(form) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (!settings) return <div className="adm-loading">Chargement…</div>;

  return (
    <div className="adm-tab-content">
      <h3 className="adm-section-title">Paramètres globaux</h3>
      <p className="adm-hint-block">
        Ces modèles sont utilisés par défaut pour tous les nodes de pipeline
        qui n'ont pas de modèle explicitement défini.
        Le changement est immédiat (sans redémarrage).
      </p>

      <div className="adm-form" style={{ maxWidth: 480 }}>
        <label>Modèle par défaut (tous les nodes)</label>
        <select value={form.default_model}
          onChange={e => setForm(f => ({ ...f, default_model: e.target.value }))}>
          {settings.available_defaults.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <label>Modèle Chairman par défaut</label>
        <select value={form.default_chairman}
          onChange={e => setForm(f => ({ ...f, default_chairman: e.target.value }))}>
          {settings.available_defaults.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {error && <div className="adm-form-error">⚠ {error}</div>}
        {saved && <div className="adm-form-success">✓ Paramètres sauvegardés</div>}

        <div className="adm-form-actions">
          <button className="adm-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Sauvegarde…' : '💾 Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function AdminPanel({ onBack }) {
  const [tab,      setTab]      = useState('users');
  const [services, setServices] = useState([]);
  const [pipelines, setPipelines] = useState([]);

  const loadServices = useCallback(async () => {
    try { setServices(await api.listServices()); }
    catch (e) { console.error(e); }
  }, []);

  const loadPipelines = useCallback(async () => {
    try {
      const res  = await apiFetch(ROUTES.groups.list);
      const data = res && res.ok ? await res.json() : [];
      setPipelines(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadServices();
    loadPipelines();
  }, [loadServices, loadPipelines]);

  const handleServicesChange = () => { loadServices(); loadPipelines(); };

  return (
    <div className="adm-root">
      <div className="adm-header">
        <button className="adm-back-btn" onClick={onBack}>← Retour</button>
        <h2 className="adm-title">Administration</h2>
        <span className="adm-badge badge-admin">admin</span>
      </div>

      <div className="adm-tabs">
        <button className={`adm-tab ${tab === 'users'     ? 'active' : ''}`} onClick={() => setTab('users')}>👤 Utilisateurs</button>
        <button className={`adm-tab ${tab === 'services'  ? 'active' : ''}`} onClick={() => setTab('services')}>🏢 Services</button>
        <button className={`adm-tab ${tab === 'pipelines' ? 'active' : ''}`} onClick={() => setTab('pipelines')}>⚡ Pipelines</button>
        <button className={`adm-tab ${tab === 'perms'   ? 'active' : ''}`} onClick={() => setTab('perms')}>🔐 Droits</button>
        <button className={`adm-tab ${tab === 'models'  ? 'active' : ''}`} onClick={() => setTab('models')}>🤖 Modèles</button>
        <button className={`adm-tab ${tab === 'rag'       ? 'active' : ''}`} onClick={() => setTab('rag')}>🧠 RAG</button>
        <button className={`adm-tab ${tab === 'mstatus'  ? 'active' : ''}`} onClick={() => setTab('mstatus')}>🟢 État modèles</button>
        <button className={`adm-tab ${tab === 'local'    ? 'active' : ''}`} onClick={() => setTab('local')}>🖥 Local</button>
        <button className={`adm-tab ${tab === 'agents'   ? 'active' : ''}`} onClick={() => setTab('agents')}>🤖 Agents V3</button>
        <button className={`adm-tab ${tab === 'catalog'  ? 'active' : ''}`} onClick={() => setTab('catalog')}>📚 Catalogue</button>
        <button className={`adm-tab ${tab === 'tokens'   ? 'active' : ''}`} onClick={() => setTab('tokens')}>🔗 Liens dashboard</button>
        <button className={`adm-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>⚙ Paramètres</button>
      </div>

      {tab === 'users'     && <UsersTab services={services} />}
      {tab === 'services'  && <ServicesTab services={services} onServicesChange={handleServicesChange} pipelines={pipelines} />}
      {tab === 'pipelines' && <PipelinesTab pipelines={pipelines} onPipelinesChange={loadPipelines} />}
      {tab === 'perms'     && <PermissionsTab services={services} pipelines={pipelines} />}
      {tab === 'models'    && <ModelsTab />}
      {/* RAGTab reste toujours monté pour éviter le double-backend react-dnd */}
      <div style={{ display: tab === 'rag' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}><RAGTab /></div>
      {tab === 'mstatus'   && <ModelStatusTab />}
      {tab === 'local'     && <LocalTab />}
      {tab === 'agents'    && <AgentsTab />}
      {tab === 'catalog'   && <CatalogTab />}
      {tab === 'tokens'    && <DashboardTokensTab />}
      {tab === 'settings'  && <SettingsTab />}
    </div>
  );
}
