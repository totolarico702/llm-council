/**
 * CaffeineValidation — Interface de validation humaine post-Chairman
 * Affiché quand le Mode Caféine est actif et qu'une réponse attend validation.
 */
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function CaffeineValidation({ pending, onValidate }) {
  const [editedText,       setEditedText]       = useState(pending.chairman_output || '');
  const [relaunchInput,    setRelaunchInput]     = useState('');
  const [showRelaunch,     setShowRelaunch]      = useState(false);
  const [loading,          setLoading]           = useState(false);

  const submit = async (action, extra = {}) => {
    setLoading(true);
    try { await onValidate(action, extra); }
    finally { setLoading(false); }
  };

  return (
    <div className="caffeine-validation">
      {/* Header */}
      <div className="cv-header">
        <span className="cv-icon">☕</span>
        <span className="cv-title">Mode Caféine — Réponse en attente de validation</span>
      </div>

      {/* Textarea éditable */}
      <div className="cv-body">
        <div className="cv-label">Réponse du Chairman (éditable) :</div>
        <textarea
          className="cv-textarea"
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          rows={10}
        />
        <div className="cv-hint">
          Relisez, modifiez si nécessaire, puis choisissez une action ci-dessous.
        </div>
      </div>

      {/* Actions */}
      <div className="cv-actions">
        {/* Approuver */}
        <button
          className="cv-btn cv-btn-approve"
          onClick={() => submit('approve')}
          disabled={loading}
        >
          ✅ Approuver et envoyer
        </button>

        {/* Modifier */}
        <button
          className="cv-btn cv-btn-modify"
          onClick={() => submit('modify', { modified_text: editedText })}
          disabled={loading || editedText === pending.chairman_output}
        >
          ✏️ Envoyer modifié
        </button>

        {/* Relancer */}
        <button
          className="cv-btn cv-btn-relaunch"
          onClick={() => setShowRelaunch(v => !v)}
          disabled={loading}
        >
          🔄 Relancer le Chairman
        </button>

        {/* Rejeter */}
        <button
          className="cv-btn cv-btn-reject"
          onClick={() => submit('reject')}
          disabled={loading}
        >
          ❌ Rejeter
        </button>
      </div>

      {/* Input relaunch */}
      {showRelaunch && (
        <div className="cv-relaunch">
          <input
            className="cv-relaunch-input"
            placeholder="Instructions pour le Chairman… (ex: Sois plus concis, plus formel…)"
            value={relaunchInput}
            onChange={e => setRelaunchInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && relaunchInput.trim()) {
                submit('relaunch', { relaunch_instructions: relaunchInput.trim() });
              }
            }}
          />
          <button
            className="cv-btn cv-btn-relaunch"
            style={{ marginTop: 6 }}
            onClick={() => submit('relaunch', { relaunch_instructions: relaunchInput.trim() })}
            disabled={loading || !relaunchInput.trim()}
          >
            {loading ? '⏳ Relance…' : '🔄 Relancer'}
          </button>
        </div>
      )}

      {loading && (
        <div className="cv-loading">⏳ Traitement en cours…</div>
      )}
    </div>
  );
}
