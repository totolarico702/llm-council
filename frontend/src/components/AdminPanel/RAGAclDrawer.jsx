/**
 * RAGAclDrawer — Panneau latéral ACL (slide-in depuis la droite)
 * Wrapper autour de RAGAclEditor
 */

import React, { useEffect } from 'react';
import RAGAclEditor from './RAGAclEditor';

export default function RAGAclDrawer({ folder, onClose }) {
  // Fermer avec Échap
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!folder) return null;

  return (
    <>
      {/* Overlay */}
      <div className="raga-drawer-overlay" onClick={onClose} />

      {/* Panneau */}
      <div className="raga-drawer">
        <div className="raga-drawer-header">
          <div>
            <div className="raga-drawer-title">🔐 Exceptions ACL</div>
            <div className="raga-drawer-subtitle">{folder.name}</div>
          </div>
          <button className="raga-drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="raga-drawer-body">
          <RAGAclEditor folder={folder} />
        </div>
      </div>
    </>
  );
}
