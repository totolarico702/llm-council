/**
 * RAADPanel — Panneau latéral droit rétractable (Recherche et Accès aux Documents)
 * Hover sur l'icône → ouvre le panel
 * Clic sur l'icône → épingle le panel
 * Clic hors du panel (non épinglé) → ferme le panel
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRAD } from '../hooks/useRAD';
import './RAADPanel.css';

/** Construit une arborescence depuis la liste plate retournée par l'API. */
function buildTree(folders) {
  const map   = {};
  const roots = [];
  folders.forEach(f => { map[f.id] = { ...f, children: [] }; });
  folders.forEach(f => {
    if (f.parent_id && map[f.parent_id]) {
      map[f.parent_id].children.push(map[f.id]);
    } else {
      roots.push(map[f.id]);
    }
  });
  return roots;
}

function getDocIcon(name = '') {
  if (name.match(/\.pdf$/i))           return '📄';
  if (name.match(/\.docx?$/i))         return '📝';
  if (name.match(/\.(md|txt|rst)$/i))  return '📃';
  return '📄';
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return ''; }
}

export default function RAADPanel({ onInsertMention }) {
  const {
    folders, documents, searchResults, loading, error,
    fetchFolders, fetchDocuments, clearDocuments,
    search, clearSearch, previewDoc,
  } = useRAD();

  const [open,           setOpen]           = useState(false);
  const [pinned,         setPinned]         = useState(false);
  const [query,          setQuery]          = useState('');
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [expanded,       setExpanded]       = useState(new Set());
  const [tooltip,        setTooltip]        = useState(null);

  const panelRef     = useRef(null);
  const tooltipTimer = useRef(null);
  const fetchedRef   = useRef(false);

  // Chargement initial des dossiers (une seule fois)
  useEffect(() => {
    if (open && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchFolders();
    }
  }, [open, fetchFolders]);

  // Fermeture au clic extérieur (si non épinglé)
  useEffect(() => {
    if (!open || pinned) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, pinned]);

  const handleRefresh = useCallback(() => {
    fetchFolders();
    if (selectedFolder) fetchDocuments(selectedFolder.id);
  }, [fetchFolders, fetchDocuments, selectedFolder]);

  const handleQueryChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    if (q.trim()) {
      setSelectedFolder(null);
      clearDocuments();
      search(q);
    } else {
      clearSearch();
    }
  };

  const toggleExpand = (folderId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  };

  const handleFolderClick = (folder) => {
    toggleExpand(folder.id);
    setSelectedFolder(folder);
    fetchDocuments(folder.id);
    setQuery('');
    clearSearch();
  };

  const handleBack = () => {
    setSelectedFolder(null);
    clearDocuments();
  };

  const handleDocHover = async (doc, e) => {
    clearTimeout(tooltipTimer.current);
    const { clientX, clientY } = e;
    tooltipTimer.current = setTimeout(async () => {
      const preview = await previewDoc(doc.id);
      if (preview) {
        setTooltip({ text: preview, filename: doc.filename || doc.name, x: clientX, y: clientY });
      }
    }, 300);
  };

  const handleDocLeave = () => {
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  };

  const handleDocClick = (doc) => {
    setTooltip(null);
    onInsertMention(doc.filename || doc.name);
  };

  const handleTriggerClick = () => {
    if (!open) {
      setOpen(true);
    } else if (!pinned) {
      setPinned(true);  // premier clic quand ouvert = épingle
    } else {
      setOpen(false);   // second clic quand épinglé = ferme tout
      setPinned(false);
    }
  };

  // ── Arborescence ──────────────────────────────────────────────────────────

  const renderTree = (nodes, depth = 0) =>
    nodes.map(folder => {
      const isActive   = selectedFolder?.id === folder.id;
      const isExpanded = expanded.has(folder.id);
      const hasKids    = folder.children.length > 0;
      return (
        <div key={folder.id}>
          <div
            className={`raad-folder-item${isActive ? ' active' : ''}`}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
            onClick={() => handleFolderClick(folder)}
          >
            <span
              className={`raad-folder-chevron${hasKids && isExpanded ? ' open' : ''}`}
              style={{ visibility: hasKids ? 'visible' : 'hidden' }}
            >
              ›
            </span>
            <span className="raad-folder-icon">{depth === 0 ? '🗂' : '📁'}</span>
            <span className="raad-folder-name">{folder.name}</span>
            {folder._access === 'read' && <span className="raad-folder-lock">🔒</span>}
          </div>
          {isExpanded && hasKids && renderTree(folder.children, depth + 1)}
        </div>
      );
    });

  // ── Mode courant ──────────────────────────────────────────────────────────

  const mode = query.trim() ? 'searching' : selectedFolder ? 'folder_selected' : 'idle';
  const tree = buildTree(folders);

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef}>
      {/* Icône déclencheur */}
      <div
        className="raad-trigger"
        onMouseEnter={() => { if (!open) setOpen(true); }}
      >
        <button
          className={`raad-icon-btn${pinned ? ' pinned' : ''}`}
          onClick={handleTriggerClick}
          title="RAAD — Recherche et Accès aux Documents"
        >
          📚
          <span>RAAD</span>
        </button>
      </div>

      {/* Panel principal */}
      <div className={`raad-panel${open ? ' open' : ''}`}>

        {/* En-tête */}
        <div className="raad-header">
          <span className="raad-title">RAAD</span>
          <button className="raad-header-btn" onClick={handleRefresh} title="Rafraîchir">🔄</button>
          <button
            className={`raad-header-btn raad-pin-btn${pinned ? ' pinned' : ''}`}
            onClick={() => setPinned(p => !p)}
            title={pinned ? 'Désépingler' : 'Épingler'}
          >
            📌
          </button>
          <button
            className="raad-header-btn"
            onClick={() => { setOpen(false); setPinned(false); }}
            title="Fermer"
          >
            ×
          </button>
        </div>

        {/* Recherche */}
        <div className="raad-search-wrap">
          <input
            className="raad-search-input"
            type="text"
            placeholder="Rechercher dans les documents…"
            value={query}
            onChange={handleQueryChange}
          />
        </div>

        {/* Corps */}
        <div className="raad-body">

          {error && (
            <div className="raad-error">
              ⚠ {error}
              <button className="raad-retry-btn" onClick={handleRefresh}>Réessayer</button>
            </div>
          )}

          {loading && (
            <div className="raad-loading">
              <div className="raad-spinner" />
              Chargement…
            </div>
          )}

          {/* Résultats de recherche */}
          {!loading && mode === 'searching' && (
            <>
              {searchResults.length === 0 && !error && (
                <div className="raad-empty">Aucun résultat pour « {query} »</div>
              )}
              {searchResults.map((r, i) => (
                <div
                  key={`${r.doc_id}-${i}`}
                  className="raad-search-result"
                  onClick={() => handleDocClick({ filename: r.filename, id: r.doc_id, name: r.filename })}
                >
                  <div className="raad-search-result-file">{r.filename}</div>
                  {r.folder_id && r.folder_id !== 'global' && (
                    <div className="raad-search-result-folder">📁 {r.folder_id}</div>
                  )}
                  <div className="raad-search-result-extract">{r.content}</div>
                </div>
              ))}
            </>
          )}

          {/* Liste de documents */}
          {!loading && mode === 'folder_selected' && (
            <>
              <button className="raad-back-btn" onClick={handleBack}>
                ‹ Retour à l'arborescence
              </button>
              <div className="raad-folder-label">{selectedFolder.name}</div>
              {documents.length === 0 && !error && (
                <div className="raad-empty">Aucun document dans ce dossier</div>
              )}
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="raad-doc-item"
                  onClick={() => handleDocClick(doc)}
                  onMouseEnter={(e) => handleDocHover(doc, e)}
                  onMouseLeave={handleDocLeave}
                >
                  <span className="raad-doc-icon">{getDocIcon(doc.filename || doc.name)}</span>
                  <div className="raad-doc-info">
                    <div className="raad-doc-name">{doc.filename || doc.name}</div>
                    <div className="raad-doc-date">{fmtDate(doc.uploaded_at || doc.created_at)}</div>
                  </div>
                  <span className="raad-doc-insert">+ insérer</span>
                </div>
              ))}
            </>
          )}

          {/* Arborescence */}
          {!loading && mode === 'idle' && (
            <>
              {folders.length === 0 && !error && (
                <div className="raad-empty">Aucun dossier accessible</div>
              )}
              {renderTree(tree)}
            </>
          )}

        </div>
      </div>

      {/* Tooltip preview */}
      {tooltip && (
        <div
          className="raad-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 8 }}
        >
          <div className="raad-tooltip-filename">{tooltip.filename}</div>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
