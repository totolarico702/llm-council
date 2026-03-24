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

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api.listUsers()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ login: '', password: '', role: 'user', service_id: '' });
    setError(''); setModal({ mode: 'create' });
  };
  const openEdit = (user) => {
    setForm({ login: user.login, password: '', role: user.role, service_id: user.service_id || '' });
    setError(''); setModal({ mode: 'edit', user });
  };

  const handleSave = async () => {
    setError('');
    if (!form.login?.trim()) { setError('Login requis'); return; }
    if (modal.mode === 'create' && !form.password) { setError('Mot de passe requis'); return; }
    setSaving(true);
    try {
      const payload = { login: form.login.trim(), role: form.role, service_id: form.service_id || null,
        ...(form.password ? { password: form.password } : {}) };
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

  return (
    <div className="adm-tab-content">
      <div className="adm-toolbar">
        <span className="adm-count">{users.length} utilisateur{users.length !== 1 ? 's' : ''}</span>
        <button className="adm-btn-primary" onClick={openCreate}>+ Nouvel utilisateur</button>
      </div>

      {loading ? <div className="adm-loading">Chargement…</div> : (
        <table className="adm-table">
          <thead><tr><th>Login</th><th>Rôle</th><th>Service</th><th>Créé le</th><th></th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="adm-cell-login">
                  <span className="adm-avatar">{u.login[0].toUpperCase()}</span>{u.login}
                </td>
                <td><span className={`adm-badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>{u.role}</span></td>
                <td>{serviceLabel(u.service_id)}</td>
                <td className="adm-cell-date">{u.created_at?.slice(0, 10)}</td>
                <td className="adm-cell-actions">
                  <button className="adm-btn-icon" onClick={() => openEdit(u)}>✏</button>
                  {u.role !== 'admin' && (
                    <button className="adm-btn-icon adm-btn-archive" title="Archiver ce user"
                      onClick={() => handleArchiveStart(u)}>📦</button>
                  )}
                  <button className="adm-btn-icon adm-btn-danger" onClick={() => setConfirm(u)}>🗑</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="adm-empty">Aucun utilisateur</td></tr>}
          </tbody>
        </table>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouvel utilisateur' : `Modifier ${modal.user.login}`} onClose={() => setModal(null)}>
          <div className="adm-form">
            <label>Login</label>
            <input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="jean.dupont" />
            <label>Mot de passe {modal.mode === 'edit' && <span className="adm-hint">(vide = inchangé)</span>}</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
            <label>Rôle</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="user">Utilisateur</option>
              <option value="admin">Administrateur</option>
            </select>
            <label>Service</label>
            <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}>
              <option value="">— Aucun —</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
                      <span key={s} className="adm-tag" style={{ background: 'rgba(59,130,246,.15)', color: '#3B82F6', borderColor: 'rgba(59,130,246,.3)' }}>{s}</span>
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
    setEditorState(null);
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

  const actionColor = { use: '#3B82F6', edit: '#F59E0B' };

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
            <span style={{ color: '#3B82F6' }}>✓ use</span> — voir et lancer
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

// ── Onglet Modèles ────────────────────────────────────────────────────────────
function ModelsTab() {
  const [allModels,     setAllModels]     = useState([]);
  const [allowedIds,    setAllowedIds]    = useState(new Set());
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [filterTag,     setFilterTag]     = useState('');
  const [saving,        setSaving]        = useState({});
  const [error,         setError]         = useState('');

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
  const TAG_COLORS = { code:'#3B82F6', vision:'#A855F7', reasoning:'#F59E0B',
                       fast:'#22C55E', chat:'#64748B', free:'#06B6D4' };

  const allTags = [...new Set(allModels.flatMap(m => m.tags || []))].sort();
  const filtered = allModels.filter(m => {
    const q = search.toLowerCase();
    const matchQ = !q || m.id.toLowerCase().includes(q) || (m.name||'').toLowerCase().includes(q);
    const matchT = !filterTag || (m.tags||[]).includes(filterTag);
    return matchQ && matchT;
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
            <th>Modèle</th>
            <th>Tags</th>
            <th>Coût</th>
            <th>Contexte</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(model => {
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
                  {model.cost_stars > 0 ? STARS[model.cost_stars] : <span style={{color:'#06B6D4'}}>Gratuit</span>}
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
    reasoning: '#8B5CF6', code: '#3B82F6', fast: '#22C55E',
    vision: '#06B6D4', chat: '#64748B', european: '#F59E0B',
    rgpd: '#F59E0B', analysis: '#EC4899', 'long-context': '#8B5CF6',
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
      {tab === 'tokens'    && <DashboardTokensTab />}
      {tab === 'settings'  && <SettingsTab />}
    </div>
  );
}
