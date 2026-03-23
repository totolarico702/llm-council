/**
 * RAGTab — Onglet RAG admin
 * Split view : Explorateur PC (gauche) ↔ Arbre RAG (droite)
 * Upload : drag PC → drop dossier RAG | drop natif Windows | bouton fallback
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tree } from 'react-arborist';
import { api, apiFetch } from '../../api';
import { makeNodeRenderer } from './RAGNodeRenderer';
import RAGPCExplorer from './RAGPCExplorer';
import RAGAclDrawer  from './RAGAclDrawer';
import RAGAuditLog   from './RAGAuditLog';

const API_BASE     = import.meta.env.VITE_API_BASE || 'http://localhost:8001';
const ACCEPTED_EXT = ['.pdf', '.docx', '.txt', '.md'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildTree(folders, docsPerFolder) {
  const map = {};
  folders.forEach((f, i) => {
    map[f.id] = {
      id: f.id,
      name: f.name,
      service: f.service,
      isDoc: false,
      children: (docsPerFolder[i] || []).map(d => ({
        id:          d.id,
        name:        d.filename,
        children:    null,
        isDoc:       true,
        filename:    d.filename,
        size_bytes:  d.size_bytes,
        uploaded_at: d.uploaded_at || d.created_at,
        user_login:  d.user_login || d.user_id,
        chunk_count: d.chunks,
      })),
    };
  });

  const roots = [];
  folders.forEach(f => {
    const node = map[f.id];
    if (f.parent_id && map[f.parent_id]) {
      const parent = map[f.parent_id];
      const firstDocIdx = parent.children.findIndex(c => c.isDoc);
      if (firstDocIdx === -1) parent.children.push(node);
      else parent.children.splice(firstDocIdx, 0, node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function insertNode(nodes, parentId, newNode) {
  if (!parentId) return [...nodes, newNode];
  return nodes.map(n => {
    if (n.id === parentId) {
      const firstDocIdx = (n.children || []).findIndex(c => c.isDoc);
      const children = [...(n.children || [])];
      if (firstDocIdx === -1) children.push(newNode);
      else children.splice(firstDocIdx, 0, newNode);
      return { ...n, children };
    }
    if (n.children) return { ...n, children: insertNode(n.children, parentId, newNode) };
    return n;
  });
}

function removeNode(nodes, id) {
  return nodes
    .filter(n => n.id !== id)
    .map(n => n.children ? { ...n, children: removeNode(n.children, id) } : n);
}

function updateNodeName(nodes, id, name) {
  return nodes.map(n => {
    if (n.id === id) return { ...n, name };
    if (n.children) return { ...n, children: updateNodeName(n.children, id, name) };
    return n;
  });
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function RAGTab() {
  const [treeData,     setTreeData]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [stats,        setStats]        = useState(null);
  const [archives,     setArchives]     = useState([]);
  const [uploadFolder, setUploadFolder] = useState(null);
  const [aclFolder,    setAclFolder]    = useState(null);
  const [treeHeight,   setTreeHeight]   = useState(400);
  const [toasts,       setToasts]       = useState([]);

  const treeRef        = useRef(null);
  const containerRef   = useRef(null);
  const uploadInputRef = useRef(null);

  // ── Toasts ──────────────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ── Hauteur arbre dynamique ──────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      setTreeHeight(entries[0].contentRect.height || 400);
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Chargement ──────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [folders, statsData] = await Promise.all([
        apiFetch('/rag/folders'),
        apiFetch('/admin/rag/stats').catch(() => null),
      ]);
      setStats(statsData);

      const token = api.auth.getToken();
      fetch(`${API_BASE}/api/v1/admin/archive/list`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then(r => r.ok ? r.json() : []).then(setArchives).catch(() => {});

      const folderList = Array.isArray(folders) ? folders : [];
      const docsPerFolder = await Promise.all(
        folderList.map(f =>
          apiFetch(`/rag/documents?folder_id=${encodeURIComponent(f.id)}`).catch(() => [])
        )
      );
      setTreeData(buildTree(folderList, docsPerFolder));
    } catch (e) {
      console.error('[RAGTab] reload error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Upload fichiers ──────────────────────────────────────────────────────────
  const uploadFiles = useCallback(async (files, folderId) => {
    const validFiles = files.filter(f =>
      ACCEPTED_EXT.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (validFiles.length < files.length) {
      addToast('⚠️ Types non supportés ignorés', 'warn');
    }
    if (validFiles.length === 0) return;

    const token = api.auth.getToken();
    for (const file of validFiles) {
      addToast(`⏳ Upload en cours : ${file.name}`, 'info');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder_id', folderId);
      try {
        const resp = await fetch(`${API_BASE}/api/v1/rag/documents`, {
          method:  'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body:    formData,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.detail || resp.statusText);
        }
        const doc = await resp.json();
        addToast(`✅ ${file.name} indexé (${doc.chunks ?? '?'} chunks)`, 'ok');
        reload();
      } catch (e) {
        addToast(`❌ Échec upload ${file.name}`, 'err');
      }
    }
  }, [addToast, reload]);

  // ── Handlers react-arborist ─────────────────────────────────────────────────
  const handleCreate = useCallback(async ({ parentId }) => {
    try {
      const folder = await apiFetch('/rag/folders', {
        method: 'POST',
        body:   JSON.stringify({ name: 'Nouveau dossier', parent_id: parentId || null, service: 'global' }),
      });
      const newNode = { id: folder.id, name: folder.name, service: folder.service, isDoc: false, children: [] };
      setTreeData(prev => insertNode(prev, parentId || null, newNode));
      return { id: folder.id };
    } catch (e) {
      alert(`Erreur création : ${e.message}`);
      return null;
    }
  }, []);

  const handleRename = useCallback(async ({ id, name, node }) => {
    if (node.data.isDoc) return;
    try {
      await apiFetch(`/rag/folders/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ name }),
      });
      setTreeData(prev => updateNodeName(prev, id, name));
    } catch (e) {
      alert(`Erreur renommage : ${e.message}`);
      node.reset();
    }
  }, []);

  const handleDeleteFolder = useCallback(async (node) => {
    try {
      await apiFetch(`/rag/folders/${node.id}`, { method: 'DELETE' });
      setTreeData(prev => removeNode(prev, node.id));
      if (uploadFolder?.id === node.id) setUploadFolder(null);
      if (aclFolder?.id === node.id) setAclFolder(null);
    } catch (e) {
      alert(`Erreur suppression : ${e.message}`);
    }
  }, [uploadFolder, aclFolder]);

  const handleDeleteDoc = useCallback(async (node) => {
    try {
      await apiFetch(`/rag/documents/${node.id}`, { method: 'DELETE' });
      setTreeData(prev => removeNode(prev, node.id));
    } catch (e) {
      alert(`Erreur suppression : ${e.message}`);
    }
  }, []);

  const handleReindex = useCallback(async (node) => {
    try {
      await apiFetch(`/rag/documents/${node.id}/reindex`, { method: 'POST' });
    } catch (e) {
      alert(`Erreur réindexation : ${e.message}`);
    }
  }, []);

  const handleMove = useCallback(async ({ dragIds, parentId }) => {
    const docId = dragIds[0];
    if (!parentId) return;
    try {
      await apiFetch(`/rag/documents/${docId}/move`, {
        method: 'PATCH',
        body:   JSON.stringify({ folder_id: parentId }),
      });
      await reload();
    } catch (e) {
      alert(`Erreur déplacement : ${e.message}`);
    }
  }, [reload]);

  // ── Upload depuis path local (panneau PC → RAG) ─────────────────────────────
  const uploadFromPath = useCallback(async (filePath, folderId) => {
    const fileName = filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    addToast(`⏳ Upload en cours : ${fileName}`, 'info');
    try {
      const token = api.auth.getToken();
      const resp  = await fetch(`${API_BASE}/api/v1/rag/documents/from-path`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ file_path: filePath, folder_id: folderId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || resp.statusText);
      }
      const doc = await resp.json();
      addToast(`✅ ${fileName} indexé (${doc.chunks ?? '?'} chunks)`, 'ok');
      reload();
    } catch (e) {
      addToast(`❌ Échec upload : ${e.message}`, 'err');
    }
  }, [addToast, reload]);

  // ── NodeRenderer (mémoïsé) ──────────────────────────────────────────────────
  const NodeRenderer = useMemo(() => makeNodeRenderer({
    onDeleteFolder: handleDeleteFolder,
    onDeleteDoc:    handleDeleteDoc,
    onReindex:      handleReindex,
    onOpenAcl:      (folderData) => setAclFolder(folderData),
    onSelectFolder: (folderData) => setUploadFolder(folderData),
    onUpload:       uploadFiles,
    uploadFromPath,
  }), [handleDeleteFolder, handleDeleteDoc, handleReindex, uploadFiles, uploadFromPath]);

  const statusColor = stats?.status === 'ok' ? '#22C55E' : '#F59E0B';

  return (
    <div className="adm-tab-content" style={{ position: 'relative' }}>

      {/* Bandeau */}
      <div className="adm-rag-bar">
        <span className="adm-rag-bar-item" style={{ color: statusColor }}>
          {stats?.backend === 'lancedb' ? '🟢 LanceDB' : stats?.backend === 'qdrant' ? '🟢 Qdrant' : '🟡 Stub JSON'}
        </span>
        <span className="adm-rag-bar-sep" />
        <span className="adm-rag-bar-item">
          <span className="adm-rag-bar-val">{stats?.chunks ?? '—'}</span> chunks indexés
        </span>
        <span className="adm-rag-bar-sep" />
        <span className="adm-rag-bar-item">
          <span className="adm-rag-bar-val">{archives.length}</span> archives
        </span>
        <span className="adm-rag-bar-sep" />
        <span className="adm-rag-bar-item adm-rag-bar-codes">
          <code>tool_type: rag_search</code>
          <code>limit: 5</code>
          <code>score_threshold: 0.3</code>
        </span>
        <button className="adm-rag-bar-refresh raga-btn raga-btn-ghost" onClick={reload}>↺ Actualiser</button>
      </div>

      {/* Section split : Explorateur PC ↔ Arbre RAG */}
      <div className="raga-section">
        <div className="raga-section-header">
          <span className="raga-section-title">🗂 Dossiers & Documents</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Bouton upload fallback (si drag impossible) */}
            <button
              className="raga-btn raga-btn-ghost"
              style={{ fontSize: 11 }}
              title={uploadFolder ? `Uploader dans « ${uploadFolder.name} »` : 'Sélectionnez un dossier'}
              onClick={() => {
                if (!uploadFolder) {
                  addToast('📁 Sélectionnez d\'abord un dossier dans l\'arbre RAG', 'info');
                  return;
                }
                uploadInputRef.current?.click();
              }}
            >+ Uploader</button>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              hidden
              accept=".pdf,.docx,.txt,.md"
              onChange={e => {
                if (uploadFolder) uploadFiles(Array.from(e.target.files), uploadFolder.id);
                e.target.value = '';
              }}
            />
            <button
              className="raga-btn raga-btn-primary"
              style={{ fontSize: 11 }}
              onClick={() => treeRef.current?.create({ type: 'internal', parentId: null })}
            >+ Nouveau dossier</button>
          </div>
        </div>

        {/* Split view */}
        <div style={{
          display: 'flex',
          height: 'calc(100vh - 300px)',
          minHeight: 300,
        }}>
          {/* Panneau gauche — Explorateur PC */}
          <div style={{
            width: '50%',
            borderRight: '1px solid #21262D',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <RAGPCExplorer onDragStart={() => {}} />
          </div>

          {/* Panneau droit — Arbre RAG */}
          <div
            ref={containerRef}
            style={{ width: '50%', overflow: 'hidden' }}
          >
            {/* Header panneau droit */}
            <div style={{
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              color: '#8B949E',
              borderBottom: '1px solid #21262D',
            }}>
              📁 Mémoire RAG
              {uploadFolder && (
                <span style={{ fontWeight: 400, marginLeft: 8, color: '#3B82F6' }}>
                  ← {uploadFolder.name}
                </span>
              )}
            </div>

            {loading ? (
              <div className="raga-loading" style={{ padding: 16 }}>
                <div className="raga-spinner" /> Chargement…
              </div>
            ) : treeData.length === 0 ? (
              <div className="raga-empty" style={{ padding: 16 }}>
                Aucun dossier — cliquez "+ Nouveau dossier" pour commencer
              </div>
            ) : (
              <Tree
                ref={treeRef}
                data={treeData}
                onCreate={handleCreate}
                onRename={handleRename}
                onMove={handleMove}
                height={treeHeight - 33} /* 33px = hauteur du header panneau droit */
                rowHeight={32}
                indent={20}
                openByDefault={true}
                disableDrag={node => !node?.data ? true : !node.data.isDoc}
                disableDrop={({ parentNode }) => parentNode?.data?.isDoc ?? false}
                onActivate={node => {
                  if (!node.data.isDoc) setUploadFolder(node.data);
                }}
              >
                {NodeRenderer}
              </Tree>
            )}
          </div>
        </div>
      </div>

      {/* Audit Log */}
      <div className="raga-section">
        <div className="raga-section-header">
          <span className="raga-section-title">📋 Audit Log RAG</span>
        </div>
        <div className="raga-section-body">
          <RAGAuditLog folders={treeData.filter(n => !n.isDoc)} />
        </div>
      </div>

      {/* Drawer ACL */}
      <RAGAclDrawer folder={aclFolder} onClose={() => setAclFolder(null)} />

      {/* Toasts */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: t.type === 'ok'   ? '#166534'
                        : t.type === 'err'  ? '#7f1d1d'
                        : t.type === 'warn' ? '#78350f'
                        : '#1e3a5f',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              maxWidth: 340,
            }}>{t.msg}</div>
          ))}
        </div>
      )}
    </div>
  );
}
