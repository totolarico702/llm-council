/**
 * RAGAuditLog — Section D admin RAG
 * Tableau paginé de l'audit log RAG avec filtres et export CSV
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api';

const ACTION_OPTIONS = [
  { value: '',                  label: 'Toutes actions' },
  { value: 'document_uploaded', label: '📤 document_uploaded' },
  { value: 'document_deleted',  label: '🗑 document_deleted' },
  { value: 'folder_created',    label: '📁 folder_created' },
  { value: 'folder_deleted',    label: '🗑 folder_deleted' },
  { value: 'acl_modified',      label: '🔐 acl_modified' },
];

const PAGE_SIZE = 50;

function ActionBadge({ action }) {
  return (
    <span className={`raga-audit-action-badge raga-audit-badge-${action}`}>
      {action}
    </span>
  );
}

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function RAGAuditLog({ folders }) {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [offset,  setOffset]  = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [filterAction,  setFilterAction]  = useState('');
  const [filterActor,   setFilterActor]   = useState('');
  const [filterFolder,  setFilterFolder]  = useState('');

  const fetchLogs = useCallback(async (off = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit:  PAGE_SIZE,
        offset: off,
        ...(filterAction && { action:    filterAction }),
        ...(filterFolder && { folder_id: filterFolder }),
      });
      const data = await apiFetch(`/rag/audit?${params}`);
      const entries = Array.isArray(data.logs) ? data.logs : [];

      // Filtre acteur côté client (pas de param actor_name côté backend)
      const filtered = filterActor
        ? entries.filter(l => (l.actor_name || '').toLowerCase().includes(filterActor.toLowerCase()))
        : entries;

      setLogs(filtered);
      setHasMore(entries.length === PAGE_SIZE);
      setOffset(off);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterActor, filterFolder]);

  useEffect(() => { fetchLogs(0); }, [fetchLogs]);

  const handleReset = () => {
    setFilterAction('');
    setFilterActor('');
    setFilterFolder('');
    setOffset(0);
  };

  const handleExportCsv = () => {
    const header = ['timestamp', 'actor_name', 'action', 'target_name', 'details'];
    const rows = logs.map(l => [
      l.timestamp || '',
      l.actor_name || '',
      l.action || '',
      l.target_name || '',
      JSON.stringify(l.details || {}),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv  = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rag_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Filtres */}
      <div className="raga-audit-filters">
        <select className="raga-select" value={filterAction} onChange={e => setFilterAction(e.target.value)}>
          {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <input
          className="raga-input"
          placeholder="Filtrer par acteur…"
          value={filterActor}
          onChange={e => setFilterActor(e.target.value)}
          style={{ width: 160 }}
        />

        <select className="raga-select" value={filterFolder} onChange={e => setFilterFolder(e.target.value)}>
          <option value="">Tous les dossiers</option>
          {(folders || []).map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        <button className="raga-btn" onClick={handleReset}>↺ Réinitialiser</button>
        <button className="raga-btn" onClick={handleExportCsv} disabled={logs.length === 0}>
          ⬇ Exporter CSV
        </button>
      </div>

      {error   && <div className="raga-error">⚠ {error}</div>}
      {loading && <div className="raga-loading"><div className="raga-spinner" /> Chargement…</div>}

      {!loading && logs.length === 0 ? (
        <div className="raga-empty">Aucune entrée dans l'audit log</div>
      ) : (
        <table className="raga-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Acteur</th>
              <th>Action</th>
              <th>Cible</th>
              <th>Détails</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--dim)' }}>{fmtTs(log.timestamp)}</td>
                <td>{log.actor_name || '—'}</td>
                <td><ActionBadge action={log.action} /></td>
                <td>{log.target_name || log.target_id || '—'}</td>
                <td>
                  <span className="raga-audit-details" title={JSON.stringify(log.details)}>
                    {log.details ? JSON.stringify(log.details) : ''}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      <div className="raga-audit-pagination">
        <button
          className="raga-btn"
          disabled={offset === 0}
          onClick={() => fetchLogs(Math.max(0, offset - PAGE_SIZE))}
        >‹ Précédent</button>
        <span>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
        <button
          className="raga-btn"
          disabled={!hasMore}
          onClick={() => fetchLogs(offset + PAGE_SIZE)}
        >Suivant ›</button>
      </div>
    </div>
  );
}
