/**
 * RAGFolderTree — Arborescence des dossiers RAG
 * Expand/collapse, breadcrumb, créer/renommer (double-clic)/supprimer
 */

import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../api';
import { ROUTES } from '../../api/routes';

function buildBreadcrumb(folders, selectedId) {
  if (!selectedId) return [];
  const map = {};
  folders.forEach(f => { map[f.id] = f; });
  const path = [];
  let cur = map[selectedId];
  while (cur) { path.unshift(cur); cur = cur.parent_id ? map[cur.parent_id] : null; }
  return path;
}

function buildTree(folders) {
  const map = {};
  const roots = [];
  folders.forEach(f => { map[f.id] = { ...f, children: [] }; });
  folders.forEach(f => {
    if (f.parent_id && map[f.parent_id]) map[f.parent_id].children.push(map[f.id]);
    else roots.push(map[f.id]);
  });
  return roots;
}

/* ── Nœud de dossier ───────────────────────────────────────────────────────── */
function FolderNode({ node, depth, selected, onSelect, onRefresh, docCounts }) {
  const [expanded,      setExpanded]      = useState(depth === 0);
  const [renaming,      setRenaming]      = useState(false);
  const [renameVal,     setRenameVal]     = useState(node.name);
  const [creatingChild, setCreatingChild] = useState(false);
  const [childName,     setChildName]     = useState('');
  const [deleting,      setDeleting]      = useState(false);
  const renameRef = useRef(null);

  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);

  const isSelected = selected?.id === node.id;
  const hasChildren = node.children.length > 0;
  const docCount = docCounts?.[node.id];
  const indent = 8 + depth * 18;

  const handleRename = async () => {
    const name = renameVal.trim();
    if (!name || name === node.name) { setRenaming(false); return; }
    try {
      await apiFetch(ROUTES.rag.folder(node.id), { method: 'PATCH', body: JSON.stringify({ name }) });
      onRefresh();
    } catch (e) { alert(`Erreur renommage : ${e.message}`); }
    setRenaming(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Supprimer le dossier « ${node.name} » ?`)) return;
    setDeleting(true);
    try {
      await apiFetch(ROUTES.rag.folder(node.id), { method: 'DELETE' });
      onRefresh();
    } catch (e) { alert(e.message || 'Erreur suppression'); setDeleting(false); }
  };

  const handleCreateChild = async () => {
    const name = childName.trim();
    if (!name) { setCreatingChild(false); return; }
    try {
      await apiFetch(ROUTES.rag.folders, {
        method: 'POST',
        body: JSON.stringify({ name, parent_id: node.id, service: node.service }),
      });
      setChildName('');
      setCreatingChild(false);
      setExpanded(true);
      onRefresh();
    } catch (e) { alert(`Erreur : ${e.message}`); }
  };

  return (
    <div>
      <div
        className={`raga-tree-node${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => { onSelect(node); if (hasChildren) setExpanded(v => !v); }}
        onDoubleClick={e => { e.stopPropagation(); setRenaming(true); setRenameVal(node.name); }}
      >
        <span
          className={`raga-tree-chevron${hasChildren && expanded ? ' open' : ''}`}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
        >›</span>

        <span className="raga-tree-icon">{depth === 0 ? '🗂' : '📁'}</span>

        {renaming ? (
          <input
            ref={renameRef}
            className="raga-tree-inline-edit"
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="raga-tree-name">{node.name}</span>
        )}

        {docCount !== undefined && (
          <span className="raga-tree-meta">{docCount} doc{docCount !== 1 ? 's' : ''}</span>
        )}

        <span className="raga-tree-actions" onClick={e => e.stopPropagation()}>
          {depth < 2 && (
            <button
              className="raga-tree-action-btn"
              title="Créer un sous-dossier"
              onClick={() => { setCreatingChild(true); setExpanded(true); }}
            >+</button>
          )}
          <button
            className="raga-tree-action-btn danger"
            title="Supprimer"
            disabled={deleting}
            onClick={handleDelete}
          >🗑</button>
        </span>
      </div>

      {/* Formulaire inline création sous-dossier */}
      {creatingChild && (
        <div style={{ paddingLeft: `${indent + 26}px`, paddingTop: 4, paddingBottom: 4 }}>
          <input
            autoFocus
            className="raga-tree-inline-edit"
            style={{ width: 180 }}
            placeholder="Nom du sous-dossier…"
            value={childName}
            onChange={e => setChildName(e.target.value)}
            onBlur={() => { if (!childName.trim()) setCreatingChild(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateChild();
              if (e.key === 'Escape') { setCreatingChild(false); setChildName(''); }
            }}
          />
        </div>
      )}

      {/* Enfants */}
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onRefresh={onRefresh}
              docCounts={docCounts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Composant principal ───────────────────────────────────────────────────── */
export default function RAGFolderTree({ selectedFolder, onSelect, folders, onRefresh, docCounts, services }) {
  const [creating,   setCreating]   = useState(false);
  const [newName,    setNewName]    = useState('');
  const [newService, setNewService] = useState('');

  const tree = buildTree(folders);
  const breadcrumb = buildBreadcrumb(folders, selectedFolder?.id);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreating(false); return; }
    try {
      await apiFetch(ROUTES.rag.folders, {
        method: 'POST',
        body: JSON.stringify({ name, parent_id: null, service: newService || 'global' }),
      });
      setNewName('');
      setCreating(false);
      onRefresh();
    } catch (e) { alert(`Erreur : ${e.message}`); }
  };

  return (
    <div>
      {/* Barre du haut */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="raga-btn raga-btn-primary" onClick={() => setCreating(v => !v)}>
          {creating ? '✕ Annuler' : '+ Nouveau dossier'}
        </button>
      </div>

      {/* Formulaire création dossier racine */}
      {creating && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            autoFocus
            className="raga-input"
            style={{ flex: 1, minWidth: 120 }}
            placeholder="Nom du dossier…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
          />
          {services?.length > 0 && (
            <select className="raga-select" value={newService} onChange={e => setNewService(e.target.value)}>
              <option value="">Service : global</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
            </select>
          )}
          <button className="raga-btn raga-btn-primary" onClick={handleCreate}>Créer</button>
        </div>
      )}

      {/* Breadcrumb */}
      {selectedFolder && (
        <div className="raga-tree-breadcrumb">
          <button className="raga-tree-bc-item" onClick={() => onSelect(null)}>← Tous les dossiers</button>
          {breadcrumb.map(f => (
            <React.Fragment key={f.id}>
              <span className="raga-tree-bc-sep">›</span>
              <button
                className={`raga-tree-bc-item${f.id === selectedFolder.id ? ' active' : ''}`}
                onClick={() => onSelect(f)}
              >{f.name}</button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Arborescence */}
      <div className="raga-tree raga-tree-scroll">
        {tree.length === 0
          ? <div className="raga-empty">Aucun dossier — créez-en un ci-dessus</div>
          : tree.map(node => (
              <FolderNode
                key={node.id}
                node={node}
                depth={0}
                selected={selectedFolder}
                onSelect={onSelect}
                onRefresh={onRefresh}
                docCounts={docCounts}
              />
            ))
        }
      </div>
    </div>
  );
}
