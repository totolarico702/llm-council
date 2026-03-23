/**
 * RAGPCExplorer — Explorateur PC via FastAPI /api/fs/browse
 * Navigation plate avec lazy expand des sous-dossiers.
 * Drag d'un fichier → setData('text/plain', path) → drop sur dossier RAG.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

function fileIcon(ext) {
  if (ext === '.pdf')  return '📕';
  if (ext === '.docx') return '📘';
  return '📄';
}

function humanSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

async function fetchDir(path) {
  const token = api.auth.getToken();
  const url   = path
    ? `${API_BASE}/api/v1/fs/browse?path=${encodeURIComponent(path)}`
    : `${API_BASE}/api/v1/fs/browse`;
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── Nœud récursif ────────────────────────────────────────────────────────────
function TreeNode({ item, depth, onDragStart }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null); // null = non chargé
  const [loading,  setLoading]  = useState(false);
  const [hover,    setHover]    = useState(false);

  const isFolder = item.type === 'folder';

  const toggle = async () => {
    if (!isFolder) return;
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const data = await fetchDir(item.path);
        setChildren(data.items);
      } catch {
        setChildren([]);
      }
      setLoading(false);
    }
    setExpanded(e => !e);
  };

  const rowStyle = {
    display:      'flex',
    alignItems:   'center',
    gap:          5,
    padding:      `3px 8px 3px ${12 + depth * 14}px`,
    fontSize:     12,
    color:        isFolder ? '#ddd' : '#bbb',
    cursor:       isFolder ? 'pointer' : 'grab',
    borderRadius: 3,
    userSelect:   'none',
    background:   hover ? 'rgba(255,255,255,0.06)' : 'transparent',
    transition:   'background 0.1s',
  };

  return (
    <>
      <div
        style={rowStyle}
        draggable={!isFolder}
        onClick={isFolder ? toggle : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragStart={!isFolder ? e => {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', item.path);
          onDragStart(item.path);
        } : undefined}
      >
        {isFolder && (
          <span style={{ fontSize: 9, color: '#666', width: 8, flexShrink: 0 }}>
            {loading ? '…' : expanded ? '▾' : '▸'}
          </span>
        )}
        {!isFolder && <span style={{ width: 8, flexShrink: 0 }} />}
        <span>{isFolder ? '📁' : fileIcon(item.ext)}</span>
        <span style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.name}
        </span>
        {!isFolder && item.size_human && (
          <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>
            {item.size_human}
          </span>
        )}
      </div>

      {isFolder && expanded && children && children.map(child => (
        <TreeNode
          key={child.id}
          item={child}
          depth={depth + 1}
          onDragStart={onDragStart}
        />
      ))}
      {isFolder && expanded && children && children.length === 0 && (
        <div style={{ paddingLeft: 12 + (depth + 1) * 14, fontSize: 11, color: '#444', padding: `2px 8px 2px ${20 + (depth + 1) * 14}px` }}>
          vide
        </div>
      )}
    </>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function RAGPCExplorer({ onDragStart }) {
  const [items,       setItems]       = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [parentPath,  setParentPath]  = useState(null);
  const [error,       setError]       = useState(null);
  const [loading,     setLoading]     = useState(true);

  const loadPath = useCallback(async (path = null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDir(path);
      setItems(data.items);
      setCurrentPath(data.path);
      setParentPath(data.parent);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPath(); }, [loadPath]);

  // Nom court du dossier courant
  const currentName = currentPath
    ? currentPath.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    : '';

  const panelStyle = {
    height:        '100%',
    display:       'flex',
    flexDirection: 'column',
    background:    '#0f1318',
    overflow:      'hidden',
  };

  const headerStyle = {
    padding:       '6px 10px',
    fontSize:      11,
    fontWeight:    700,
    color:         '#8B949E',
    borderBottom:  '1px solid #21262D',
    display:       'flex',
    alignItems:    'center',
    gap:           6,
    flexShrink:    0,
    minHeight:     33,
  };

  return (
    <div style={panelStyle}>
      {/* Header : chemin courant + bouton retour */}
      <div style={headerStyle}>
        {parentPath && (
          <button
            onClick={() => loadPath(parentPath)}
            title="Dossier parent"
            style={{
              background: 'none', border: 'none', color: '#3B82F6',
              cursor: 'pointer', fontSize: 12, padding: '0 4px', flexShrink: 0,
            }}
          >←</button>
        )}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#aaa',
          }}
          title={currentPath || ''}
        >
          📂 {currentName || 'Explorateur PC'}
        </span>
        <button
          onClick={() => loadPath(currentPath)}
          title="Actualiser"
          style={{
            background: 'none', border: 'none', color: '#555',
            cursor: 'pointer', fontSize: 11, padding: '0 2px', flexShrink: 0,
          }}
        >↺</button>
      </div>

      {/* Breadcrumb — chemin complet */}
      {currentPath && (
        <div style={{
          padding:    '2px 10px',
          fontSize:   10,
          color:      '#484F58',
          borderBottom: '1px solid #1a1f27',
          flexShrink: 0,
          overflow:   'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
          title={currentPath}
        >
          {currentPath}
        </div>
      )}

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading && (
          <div style={{ padding: 16, fontSize: 12, color: '#555' }}>Chargement…</div>
        )}
        {error && (
          <div style={{ padding: 12, fontSize: 12, color: '#F85149' }}>
            ⚠ {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: '#484F58' }}>
            Aucun fichier compatible (PDF, DOCX, TXT, MD)
          </div>
        )}
        {!loading && !error && items.map(item => (
          <TreeNode
            key={item.id}
            item={item}
            depth={0}
            onDragStart={onDragStart}
          />
        ))}
      </div>

      {/* Pied — indication drag */}
      <div style={{
        padding:      '5px 10px',
        fontSize:     10,
        color:        '#484F58',
        borderTop:    '1px solid #21262D',
        flexShrink:   0,
      }}>
        Glissez un fichier vers un dossier RAG →
      </div>
    </div>
  );
}
