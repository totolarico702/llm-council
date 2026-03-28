/**
 * FeedbackBar — Boutons de feedback discrets sous les réponses Chairman
 * 👍 👎 ⭐1-5 → POST /api/v1/scores
 */
import { useState } from 'react';
import { api } from '../api';

export default function FeedbackBar({ conversationId, model, stage = 'chairman' }) {
  const [submitted, setSubmitted] = useState(false);
  const [selected,  setSelected]  = useState(null); // 'up' | 'down' | 1..5
  const [loading,   setLoading]   = useState(false);

  const submit = async (type, value) => {
    if (submitted || loading) return;
    setLoading(true);
    setSelected(type === 'star' ? value : type);

    // Mapper sur le schéma de score
    let scores;
    if (type === 'up')   scores = { overall: 8 };
    if (type === 'down') scores = { overall: 3 };
    if (type === 'star') scores = { overall: value * 2 }; // 1-5 → 2-10

    try {
      await api.submitScore({
        conversation_id: conversationId,
        model:           model || 'unknown',
        stage,
        scores,
      });
      setSubmitted(true);
    } catch (e) {
      console.error('FeedbackBar: submit failed', e);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="feedback-bar feedback-bar-done">
        ✓ Merci pour votre retour
      </div>
    );
  }

  return (
    <div className="feedback-bar">
      <span className="feedback-label">Cette réponse était :</span>

      <button
        className={`feedback-btn ${selected === 'up' ? 'selected' : ''}`}
        onClick={() => submit('up')}
        disabled={loading}
        title="Bonne réponse"
      >👍</button>

      <button
        className={`feedback-btn ${selected === 'down' ? 'selected' : ''}`}
        onClick={() => submit('down')}
        disabled={loading}
        title="Mauvaise réponse"
      >👎</button>

      <span className="feedback-sep">|</span>

      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`feedback-star ${selected === n ? 'selected' : ''}`}
          onClick={() => submit('star', n)}
          disabled={loading}
          title={`${n} étoile${n > 1 ? 's' : ''}`}
        >
          {selected !== null && typeof selected === 'number'
            ? n <= selected ? '⭐' : '☆'
            : '☆'}
        </button>
      ))}
    </div>
  );
}
