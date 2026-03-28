/**
 * RAGNodeRenderer — Rendu custom pour react-arborist
 * Dossier : 🗂 Nom  [nb docs]  [+] [✏] [⚙ACL] [🗑]
 *   → Accepte le drop de fichiers système (drag natif depuis l'explorateur)
 * Document : 📄 nom.pdf  [taille]  [↺] [🗑]
 */

import React, { useState } from 'react';

const ACCEPTED_EXT = ['.pdf', '.docx', '.txt', '.md', '.pptx', '.xlsx', '.xls', '.ods'];

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Factory qui crée le NodeRenderer avec les callbacks en closure.
 * Utiliser dans useMemo pour éviter de recréer le composant à chaque render.
 */
export function makeNodeRenderer({ onDeleteFolder, onDeleteDoc, onReindex, onOpenAcl, onSelectFolder, onUpload, uploadFromPath }) {
  return function NodeRenderer({ node, style, tree }) {
    const [hovering,   setHovering]   = useState(false);
    const [reindexing, setReindexing] = useState(false);
    const [deleting,   setDeleting]   = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    const isDoc    = !!node.data.isDoc;
    const docCount = isDoc ? 0 : (node.children?.filter(c => c.data.isDoc).length ?? 0);

    // ── Mode édition (rename inline) ─────────────────────────────────────────
    if (node.isEditing) {
      return (
        <div style={style} className="raga-arb-row raga-arb-editing">
          <input
            autoFocus
            className="raga-tree-inline-edit"
            defaultValue={node.data.name}
            style={{ flex: 1, marginLeft: 4 }}
            onBlur={e => node.submit(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') node.submit(e.currentTarget.value);
              if (e.key === 'Escape') node.reset();
            }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      );
    }

    // ── Handlers actions ──────────────────────────────────────────────────────
    const handleReindex = async (e) => {
      e.stopPropagation();
      setReindexing(true);
      await onReindex(node);
      setReindexing(false);
    };

    const handleDeleteDoc = async (e) => {
      e.stopPropagation();
      if (!window.confirm(`Supprimer « ${node.data.filename} » et ses chunks ?`)) return;
      setDeleting(true);
      await onDeleteDoc(node);
      setDeleting(false);
    };

    const handleDeleteFolder = async (e) => {
      e.stopPropagation();
      const hasContent = node.children?.length > 0;
      if (hasContent) {
        alert('Supprimez d\'abord les sous-dossiers et documents de ce dossier.');
        return;
      }
      if (!window.confirm(`Supprimer le dossier « ${node.data.name} » ?`)) return;
      setDeleting(true);
      await onDeleteFolder(node);
      setDeleting(false);
    };

    const handleCreateChild = (e) => {
      e.stopPropagation();
      tree.create({ type: 'internal', parentId: node.id });
    };

    const handleEdit = (e) => {
      e.stopPropagation();
      node.edit();
    };

    const handleOpenAcl = (e) => {
      e.stopPropagation();
      onOpenAcl(node.data);
    };

    const handleRowClick = () => {
      if (!isDoc) {
        node.toggle();
        onSelectFolder(node.data);
      } else {
        onSelectFolder(node.parent?.data ?? null);
      }
    };

    // ── Drag natif fichiers système ou panneau PC (dossiers uniquement) ──────
    const handleDragOver = (e) => {
      // Accepter : fichiers système (Windows Explorer) OU path texte (panneau PC)
      const hasFiles = e.dataTransfer.types.includes('Files');
      const hasPath  = e.dataTransfer.types.includes('text/plain');
      if (!hasFiles && !hasPath) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    };

    const handleDragLeave = (e) => {
      e.stopPropagation();
      // Éviter le flicker quand on passe sur un enfant du nœud
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setIsDragOver(false);
      }
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      // Source prioritaire : panneau PC (path via dataTransfer text/plain)
      const filePath = e.dataTransfer.getData('text/plain');
      if (filePath && uploadFromPath) {
        await uploadFromPath(filePath, node.data.id);
        return;
      }

      // Fallback : drag natif depuis l'explorateur Windows (File objects)
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onUpload(files, node.data.id);
      }
    };

    // ── Rendu dossier ─────────────────────────────────────────────────────────
    if (!isDoc) {
      return (
        <div
          style={{
            ...style,
            background:    isDragOver ? 'rgba(184, 148, 31, 0.1)' : undefined,
            outline:       isDragOver ? '1px dashed #b8941f' : undefined,
            borderRadius:  isDragOver ? '4px' : undefined,
            transition:    'background 0.15s, outline 0.15s',
          }}
          className={`raga-arb-row${node.isSelected ? ' selected' : ''}`}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => { setHovering(false); setIsDragOver(false); }}
          onClick={handleRowClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className="raga-arb-chevron" style={{ opacity: node.children?.length ? 1 : 0.3 }}>
            {node.isOpen ? '▾' : '▸'}
          </span>
          <span className="raga-arb-icon">{isDragOver ? '📂' : '🗂'}</span>
          <span className="raga-arb-name">{node.data.name}</span>
          <span className="raga-arb-meta">
            {isDragOver ? 'Déposer ici' : `${docCount} doc${docCount !== 1 ? 's' : ''}`}
          </span>

          {hovering && !deleting && !isDragOver && (
            <span className="raga-arb-actions" onClick={e => e.stopPropagation()}>
              {node.level < 2 && (
                <button className="raga-tree-action-btn" title="Créer un sous-dossier" onClick={handleCreateChild}>+</button>
              )}
              <button className="raga-tree-action-btn" title="Renommer" onClick={handleEdit}>✏</button>
              <button className="raga-tree-action-btn" title="Permissions ACL" onClick={handleOpenAcl}>⚙</button>
              <button className="raga-tree-action-btn danger" title="Supprimer" onClick={handleDeleteFolder}>🗑</button>
            </span>
          )}
          {deleting && <span className="raga-arb-meta"><div className="raga-spinner" style={{ width: 10, height: 10 }} /></span>}
        </div>
      );
    }

    // ── Rendu document ────────────────────────────────────────────────────────
    return (
      <div
        style={style}
        className={`raga-arb-row raga-arb-doc${node.isSelected ? ' selected' : ''}`}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={handleRowClick}
      >
        <span className="raga-arb-icon" style={{ marginLeft: 18 }}>📄</span>
        <span className="raga-arb-name">{node.data.filename || node.data.name}</span>
        <span className="raga-arb-meta">{fmtSize(node.data.size_bytes)}</span>

        {hovering && !reindexing && !deleting && (
          <span className="raga-arb-actions" onClick={e => e.stopPropagation()}>
            <button className="raga-tree-action-btn" title="Réindexer" onClick={handleReindex}>↺</button>
            <button className="raga-tree-action-btn danger" title="Supprimer" onClick={handleDeleteDoc}>🗑</button>
          </span>
        )}
        {(reindexing || deleting) && (
          <span className="raga-arb-meta">
            <div className="raga-spinner" style={{ width: 10, height: 10 }} />
          </span>
        )}
      </div>
    );
  };
}
