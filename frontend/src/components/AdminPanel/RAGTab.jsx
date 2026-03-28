/**
 * RAGTab — Onglet RAG admin
 * Split view : Explorateur PC (gauche) ↔ Arbre RAG (droite)
 * Upload : drag PC → drop dossier RAG | drop natif Windows | bouton fallback
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tree } from 'react-arborist';
import { apiFetch } from '../../api';
import { ROUTES } from '../../api/routes.js';
import { makeNodeRenderer } from './RAGNodeRenderer';
import RAGPCExplorer from './RAGPCExplorer';
import RAGAclDrawer  from './RAGAclDrawer';
import RAGAuditLog   from './RAGAuditLog';

const ACCEPTED_EXT = ['.pdf', '.docx', '.txt', '.md', '.pptx', '.xlsx', '.xls', '.ods'];

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
  const [auditKey,     setAuditKey]     = useState(0);
  const [auditOpen,    setAuditOpen]    = useState(false);

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
      const [foldersRes, statsRes] = await Promise.all([
        apiFetch(ROUTES.rag.folders),
        apiFetch(ROUTES.admin.ragStats).catch(() => null),
      ]);
      const folders   = foldersRes && foldersRes.ok ? await foldersRes.json() : [];
      const statsData = statsRes   && statsRes.ok   ? await statsRes.json()   : null;
      setStats(statsData);

      apiFetch(ROUTES.admin.archiveList)
        .then(r => r && r.ok ? r.json() : []).then(setArchives).catch(() => {});

      const folderList = Array.isArray(folders) ? folders : [];
      const docsPerFolder = await Promise.all(
        folderList.map(f =>
          apiFetch(`${ROUTES.rag.documents}?folder_id=${encodeURIComponent(f.id)}`)
            .then(r => r && r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      setTreeData(buildTree(folderList, docsPerFolder));
      setAuditKey(k => k + 1);
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

    for (const file of validFiles) {
      addToast(`⏳ Upload en cours : ${file.name}`, 'info');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder_id', folderId);
      try {
        const resp = await apiFetch(ROUTES.rag.documents, {
          method: 'POST',
          body:   formData,
        });
        if (!resp || !resp.ok) {
          const err = resp ? await resp.json().catch(() => ({})) : {};
          throw new Error(err.detail || (resp ? resp.statusText : 'Erreur réseau'));
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
      const res    = await apiFetch(ROUTES.rag.folders, {
        method: 'POST',
        body:   JSON.stringify({ name: 'Nouveau dossier', parent_id: parentId || null, service: 'global' }),
      });
      const folder = res && res.ok ? await res.json() : null;
      if (!folder) throw new Error('Création échouée');
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
      await apiFetch(ROUTES.rag.folder(id), {
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
      await apiFetch(ROUTES.rag.folder(node.id), { method: 'DELETE' });
      setTreeData(prev => removeNode(prev, node.id));
      if (uploadFolder?.id === node.id) setUploadFolder(null);
      if (aclFolder?.id === node.id) setAclFolder(null);
    } catch (e) {
      alert(`Erreur suppression : ${e.message}`);
    }
  }, [uploadFolder, aclFolder]);

  const handleDeleteDoc = useCallback(async (node) => {
    try {
      await apiFetch(ROUTES.rag.document(node.id), { method: 'DELETE' });
      setTreeData(prev => removeNode(prev, node.id));
    } catch (e) {
      alert(`Erreur suppression : ${e.message}`);
    }
  }, []);

  const handleReindex = useCallback(async (node) => {
    try {
      await apiFetch(ROUTES.rag.documentReindex(node.id), { method: 'POST' });
    } catch (e) {
      alert(`Erreur réindexation : ${e.message}`);
    }
  }, []);

  const handleMove = useCallback(async ({ dragIds, parentId }) => {
    const docId = dragIds[0];
    if (!parentId) return;
    try {
      await apiFetch(ROUTES.rag.documentMove(docId), {
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
      const resp = await apiFetch(ROUTES.rag.uploadFromPath, {
        method: 'POST',
        body:   JSON.stringify({ file_path: filePath, folder_id: folderId }),
      });
      if (!resp || !resp.ok) {
        const err = resp ? await resp.json().catch(() => ({})) : {};
        throw new Error(err.detail || (resp ? resp.statusText : 'Erreur réseau'));
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
    <div className="adm-tab-content" style={{ padding: 0, gap: 0, overflow: 'hidden' }}>

      {/* Zone scrollable : bandeau + split view */}
      <div style={{
        flex: 1, minHeight: 0,
        overflowY: 'auto',
        padding: '18px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--border,#30363D) transparent',
      }}>

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
              accept=".pdf,.docx,.txt,.md,.pptx,.xlsx,.xls,.ods"
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
                <span style={{ fontWeight: 400, marginLeft: 8, color: '#b8941f' }}>
                  ← {uploadFolder.name}
                </span>
              )}
            </div>

            {/* Tree toujours monté — évite le double-backend react-dnd au remount */}
            <div style={{ position: 'relative' }}>
              {loading && treeData.length === 0 && (
                <div className="raga-loading" style={{ position: 'absolute', inset: 0, zIndex: 1, padding: 16 }}>
                  <div className="raga-spinner" /> Chargement…
                </div>
              )}
              {!loading && treeData.length === 0 && (
                <div className="raga-empty" style={{ position: 'absolute', inset: 0, zIndex: 1, padding: 16 }}>
                  Aucun dossier — cliquez "+ Nouveau dossier" pour commencer
                </div>
              )}
              {loading && treeData.length > 0 && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="raga-spinner" />
                </div>
              )}
              <Tree
                ref={treeRef}
                data={treeData}
                onCreate={handleCreate}
                onRename={handleRename}
                onMove={handleMove}
                height={treeHeight - 33}
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
            </div>
          </div>
        </div>
      </div>

      </div>{/* fin zone scrollable */}

      {/* Tiroir audit — toujours en bas, ne recouvre jamais complètement le split */}
      <div style={{
        flexShrink: 0,
        height: auditOpen ? 320 : 40,
        transition: 'height 0.25s ease',
        overflow: 'hidden',
        borderTop: '2px solid #21262D',
        background: '#161B22',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Barre de titre cliquable */}
        <div
          onClick={() => setAuditOpen(o => !o)}
          style={{
            height: 40, flexShrink: 0,
            display: 'flex', alignItems: 'center',
            padding: '0 16px', gap: 8,
            cursor: 'pointer', userSelect: 'none',
            borderBottom: auditOpen ? '1px solid #21262D' : 'none',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: '#8B949E', flex: 1 }}>
            📋 Audit Log RAG
          </span>
          <span style={{
            color: '#555', fontSize: 10,
            display: 'inline-block',
            transition: 'transform 0.25s',
            transform: auditOpen ? 'none' : 'rotate(180deg)',
          }}>▲</span>
        </div>
        {/* Contenu */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 12px' }}>
          <RAGAuditLog folders={treeData.filter(n => !n.isDoc)} refreshKey={auditKey} />
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
