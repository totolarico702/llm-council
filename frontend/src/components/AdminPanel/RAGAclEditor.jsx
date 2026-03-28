/**
 * RAGAclEditor — Section C admin RAG
 * Gestion des exceptions ACL d'un dossier sélectionné
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api';
import { ROUTES } from '../../api/routes.js';

const ACCESS_LEVELS = ['read', 'write', 'admin', 'none'];

function AccessBadge({ level }) {
  return <span className={`raga-badge raga-badge-${level}`}>{level}</span>;
}

export default function RAGAclEditor({ folder }) {
  const [acl,     setAcl]     = useState(null);
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Formulaire ajout
  const [addType,   setAddType]   = useState('user');  // 'user' | 'role'
  const [addTarget, setAddTarget] = useState('');
  const [addAccess, setAddAccess] = useState('read');
  const [adding,    setAdding]    = useState(false);

  // Utiliser folderId (primitif) comme dépendance — évite les re-renders en boucle
  const folderId = folder?.id;

  const fetchAcl = useCallback(async () => {
    if (!folderId) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await apiFetch(ROUTES.rag.folderAcl(folderId));
      const data = res && res.ok ? await res.json() : null;
      setAcl(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [folderId]);  // folderId uniquement, pas l'objet folder

  useEffect(() => { fetchAcl(); }, [folderId]);  // déclenché uniquement si l'id change

  useEffect(() => {
    apiFetch(ROUTES.admin.users)
      .then(res => res && res.ok ? res.json() : [])
      .then(data => { setUsers(Array.isArray(data) ? data : []); })
      .catch(() => {});
  }, []);

  if (!folder) return null;

  const exceptions = acl?.exceptions || [];
  const serviceName = folder.service || 'global';

  const handleToggleInherit = async () => {
    const updated = { ...acl, inherit: !acl.inherit };
    try {
      const res    = await apiFetch(ROUTES.rag.folderAcl(folderId), {
        method: 'PATCH',
        body:   JSON.stringify(updated),
      });
      const result = res && res.ok ? await res.json() : {};
      setAcl(result.acl || result);
    } catch (e) {
      alert(`Erreur : ${e.message}`);
    }
  };

  const handleDeleteException = async (exc) => {
    if (!exc.id) {
      // Pas d'id — fallback : PATCH sans cet élément
      const updated = { ...acl, exceptions: exceptions.filter(e => e !== exc) };
      try {
        const res    = await apiFetch(ROUTES.rag.folderAcl(folderId), {
          method: 'PATCH',
          body:   JSON.stringify(updated),
        });
        const result = res && res.ok ? await res.json() : {};
        setAcl(result.acl || result);
      } catch (e) { alert(`Erreur : ${e.message}`); }
      return;
    }
    try {
      await apiFetch(ROUTES.rag.folderAclItem(folderId, exc.id), { method: 'DELETE' });
      fetchAcl();
    } catch (e) {
      alert(`Erreur : ${e.message}`);
    }
  };

  const handleAdd = async () => {
    if (!addTarget.trim()) return;
    setAdding(true);
    const newExc = {
      id:     crypto.randomUUID(),
      access: addAccess,
      ...(addType === 'user'
        ? { user_id: addTarget }
        : { role: addTarget }),
    };
    const updated = { ...acl, exceptions: [...exceptions, newExc] };
    try {
      const res    = await apiFetch(ROUTES.rag.folderAcl(folderId), {
        method: 'PATCH',
        body:   JSON.stringify(updated),
      });
      const result = res && res.ok ? await res.json() : {};
      setAcl(result.acl || result);
      setAddTarget('');
    } catch (e) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setAdding(false);
    }
  };

  const labelFor = (exc) => {
    if (exc.user_id) {
      const u = users.find(u => u.id === exc.user_id);
      return u ? `👤 ${u.login}` : `👤 ${exc.user_id}`;
    }
    if (exc.role) return `🏷 ${exc.role}`;
    return '?';
  };

  return (
    <div>
      {error && <div className="raga-error">⚠ {error}</div>}
      {loading && <div className="raga-loading"><div className="raga-spinner" /> Chargement ACL…</div>}

      {acl && (
        <>
          {/* Héritage service */}
          <div className="raga-acl-inherit-row">
            <input
              type="checkbox"
              id="inherit-chk"
              checked={!!acl.inherit}
              onChange={handleToggleInherit}
            />
            <label htmlFor="inherit-chk" style={{ cursor: 'pointer' }}>
              Hériter des permissions du service : <strong>{serviceName}</strong>
              {acl.inherit && <span style={{ color: 'var(--mute)', marginLeft: 6, fontSize: 10 }}>(accès read pour le service)</span>}
            </label>
          </div>

          {/* Tableau des exceptions */}
          {exceptions.length === 0 ? (
            <div className="raga-empty">Aucune exception — héritage service appliqué</div>
          ) : (
            <table className="raga-table">
              <thead>
                <tr>
                  <th>Entité</th>
                  <th>Niveau d'accès</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((exc, i) => (
                  <tr key={exc.id || i}>
                    <td>{labelFor(exc)}</td>
                    <td><AccessBadge level={exc.access || 'none'} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="raga-btn raga-btn-danger"
                        onClick={() => handleDeleteException(exc)}
                        title="Supprimer cette exception"
                      >🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Formulaire ajout */}
          <div className="raga-acl-add-row">
            <select className="raga-select" value={addType} onChange={e => { setAddType(e.target.value); setAddTarget(''); }}>
              <option value="user">Utilisateur</option>
              <option value="role">Rôle</option>
            </select>

            {addType === 'user' ? (
              <select className="raga-select" value={addTarget} onChange={e => setAddTarget(e.target.value)}>
                <option value="">— Choisir un utilisateur —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.login}</option>
                ))}
              </select>
            ) : (
              <input
                className="raga-input"
                placeholder="Nom du rôle (ex: manager)"
                value={addTarget}
                onChange={e => setAddTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              />
            )}

            <select className="raga-select" value={addAccess} onChange={e => setAddAccess(e.target.value)}>
              {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            <button
              className="raga-btn raga-btn-primary"
              onClick={handleAdd}
              disabled={adding || !addTarget.trim()}
            >
              {adding ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
