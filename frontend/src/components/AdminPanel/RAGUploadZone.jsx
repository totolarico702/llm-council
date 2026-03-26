/**
 * RAGUploadZone — Zone drag & drop + bouton fichier
 * Upload vers le dossier sélectionné
 */

import React, { useState, useRef } from 'react';
import { apiFetch } from '../../api';
import { ROUTES } from '../../api/routes.js';

const ZONE_STYLE = {
  border: '2px dashed #555',
  borderRadius: '8px',
  minHeight: '160px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '12px',
  color: '#aaa',
  fontSize: '14px',
  cursor: 'pointer',
};

export default function RAGUploadZone({ folder, onComplete }) {
  const [uploads,  setUploads]  = useState([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const uploadFile = async (file) => {
    const uid = `${Date.now()}-${Math.random()}`;
    setUploads(prev => [...prev, { id: uid, name: file.name, status: 'uploading' }]);

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
      const doc    = await resp.json();
      const chunks = doc.chunks ?? '?';
      setUploads(prev => prev.map(u =>
        u.id === uid ? { ...u, status: 'ok', chunks } : u
      ));
      onComplete?.();
    } catch (e) {
      setUploads(prev => prev.map(u =>
        u.id === uid ? { ...u, status: 'error', error: e.message } : u
      ));
    }

    setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uid)), 5000);
  };

  const handleFileChange = (e) => {
    Array.from(e.target.files).forEach(uploadFile);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (!folder) return;
    Array.from(e.dataTransfer.files).forEach(uploadFile);
  };

  return (
    <div>
      <div
        style={{
          ...ZONE_STYLE,
          borderColor: dragging ? '#b8941f' : '#555',
          background:  dragging ? 'rgba(184,148,31,0.06)' : undefined,
        }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <span style={{ fontSize: '32px' }}>📁</span>
        {folder ? (
          <span>Glissez vos fichiers dans <strong style={{ color: '#ccc' }}>{folder.name}</strong></span>
        ) : (
          <span>Sélectionnez un dossier pour uploader</span>
        )}
        <span style={{ fontSize: '12px', color: '#666' }}>PDF, DOCX, TXT, MD</span>
        {folder && (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ marginTop: '8px', padding: '6px 16px', cursor: 'pointer' }}
          >
            Choisir fichier(s)
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.txt,.md"
          onChange={handleFileChange}
        />
      </div>

      {uploads.length > 0 && (
        <div className="raga-upload-list">
          {uploads.map(u => (
            <div key={u.id} className="raga-upload-item">
              <span className="raga-upload-name">{u.name}</span>
              {u.status === 'ok'       && <span className="raga-upload-status-ok">✅ Indexé ({u.chunks} chunks)</span>}
              {u.status === 'error'    && <span className="raga-upload-status-err">❌ {u.error}</span>}
              {u.status === 'uploading' && <span style={{ fontSize: 11, color: '#8B949E' }}>⏳ Upload…</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
