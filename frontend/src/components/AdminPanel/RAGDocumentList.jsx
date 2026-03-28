/**
 * RAGDocumentList — Section B admin RAG
 * Liste des documents d'un dossier + upload drag&drop + reindex
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../api';
import { ROUTES } from '../../api/routes.js';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}
function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

const ACCEPTED = '.pdf,.docx,.doc,.txt,.md,.markdown,.pptx,.xlsx,.xls,.ods';

export default function RAGDocumentList({ folder, onDocCountChange }) {
  const [docs,     setDocs]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [uploads,  setUploads]  = useState([]);   // { id, name, progress, status, error }
  const [dragging, setDragging] = useState(false);
  const [reindexing, setReindexing] = useState(new Set());
  const fileRef = useRef(null);

  const fetchDocs = useCallback(async () => {
    if (!folder) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await apiFetch(`${ROUTES.rag.documents}?folder_id=${encodeURIComponent(folder.id)}`);
      const data = res && res.ok ? await res.json() : [];
      const list = Array.isArray(data) ? data : [];
      setDocs(list);
      onDocCountChange?.(folder.id, list.length);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [folder, onDocCountChange]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const uploadFile = async (file) => {
    const uid = `${Date.now()}-${Math.random()}`;
    setUploads(prev => [...prev, { id: uid, name: file.name, progress: 10, status: 'uploading' }]);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder_id', folder.id);

    try {
      const resp = await apiFetch(ROUTES.rag.documents, {
        method: 'POST',
        body:   formData,
      });
      if (!resp || !resp.ok) {
        const err = resp ? await resp.json().catch(() => ({ detail: resp.statusText })) : {};
        throw new Error(err.detail || (resp ? resp.statusText : 'Erreur réseau'));
      }
      setUploads(prev => prev.map(u => u.id === uid ? { ...u, progress: 100, status: 'ok' } : u));
      fetchDocs();
    } catch (e) {
      setUploads(prev => prev.map(u => u.id === uid ? { ...u, progress: 100, status: 'error', error: e.message } : u));
    }

    // Auto-dismiss après 4s
    setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uid)), 4000);
  };

  const handleFiles = (files) => {
    Array.from(files).forEach(f => uploadFile(f));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Supprimer « ${doc.filename} » et ses chunks ?`)) return;
    try {
      await apiFetch(ROUTES.rag.document(doc.id), { method: 'DELETE' });
      fetchDocs();
    } catch (e) {
      alert(`Erreur : ${e.message}`);
    }
  };

  const handleReindex = async (doc) => {
    setReindexing(prev => new Set(prev).add(doc.id));
    try {
      await apiFetch(ROUTES.rag.documentReindex(doc.id), { method: 'POST' });
      fetchDocs();
    } catch (e) {
      alert(`Erreur réindexation : ${e.message}`);
    } finally {
      setReindexing(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
    }
  };

  if (!folder) return null;

  return (
    <div>
      {error && <div className="raga-error">⚠ {error}</div>}

      {loading ? (
        <div className="raga-loading"><div className="raga-spinner" /> Chargement…</div>
      ) : docs.length === 0 ? (
        <div className="raga-empty">Aucun document — uploadez des fichiers ci-dessous</div>
      ) : (
        <table className="raga-table">
          <thead>
            <tr>
              <th>Fichier</th>
              <th>Taille</th>
              <th>Date upload</th>
              <th>Uploadé par</th>
              <th>Chunks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map(doc => (
              <tr key={doc.id}>
                <td><span style={{ marginRight: 5 }}>📄</span>{doc.filename}</td>
                <td style={{ color: 'var(--dim)' }}>{fmtSize(doc.size_bytes)}</td>
                <td style={{ color: 'var(--dim)' }}>{fmtDate(doc.uploaded_at || doc.created_at)}</td>
                <td style={{ color: 'var(--dim)' }}>{doc.user_login || doc.user_id || '—'}</td>
                <td style={{ color: 'var(--dim)' }}>{doc.chunks ?? '—'}</td>
                <td style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button
                    className="raga-btn raga-btn-ghost"
                    title="Réindexer"
                    disabled={reindexing.has(doc.id)}
                    onClick={() => handleReindex(doc)}
                  >
                    {reindexing.has(doc.id) ? <span className="raga-spinner" style={{ width: 10, height: 10 }} /> : '↺'}
                  </button>
                  <button
                    className="raga-btn raga-btn-danger"
                    title="Supprimer"
                    onClick={() => handleDelete(doc)}
                  >🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Zone upload */}
      <div
        className={`raga-dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <div className="raga-dropzone-icon">📂</div>
        <div>Glissez vos fichiers ici</div>
        <div>ou <strong>cliquez pour choisir</strong></div>
        <div className="raga-dropzone-hint">PDF, DOCX, TXT, MD acceptés</div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
      />

      {/* Uploads en cours */}
      {uploads.length > 0 && (
        <div className="raga-upload-list">
          {uploads.map(u => (
            <div key={u.id} className="raga-upload-item">
              <span className="raga-upload-name">{u.name}</span>
              {u.status === 'ok'    && <span className="raga-upload-status-ok">✅ Indexé</span>}
              {u.status === 'error' && <span className="raga-upload-status-err">❌ {u.error}</span>}
              {u.status === 'uploading' && (
                <div className="raga-upload-progress">
                  <div className="raga-upload-bar" style={{ width: `${u.progress}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
