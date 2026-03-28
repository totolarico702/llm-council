import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import { ROUTES } from '../api/routes';
import './ImageStudio.css';

// Base URL pour construire les URLs d'affichage des images servies par le backend
const API = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

const ENHANCE_MODELS = [
  { id: 'openai/gpt-4o-mini',           label: 'GPT-4o Mini' },
  { id: 'google/gemini-flash-1.5',       label: 'Gemini Flash' },
  { id: 'anthropic/claude-haiku',        label: 'Claude Haiku' },
];

export default function ImageStudio() {
  const [prompt, setPrompt]           = useState('');
  const [imageModels, setImageModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('1:1');
  
  const [enhanceModel, setEnhanceModel]   = useState('openai/gpt-4o-mini');

  const [gallery, setGallery]         = useState([]);
  const [lightbox, setLightbox]       = useState(null);

  const [loadingEnhance, setLoadingEnhance] = useState(false);
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [error, setError]             = useState(null);

  const textareaRef = useRef(null);

  // Charger les modèles image + la galerie au montage
  useEffect(() => {
    apiFetch(ROUTES.image.models)
      .then(r => r.json())
      .then(d => {
        setImageModels(d.models || []);
        if (d.models?.length) setSelectedModel(d.models[0].id);
      })
      .catch(() => {});
    loadGallery();
  }, []);

  // Mettre à jour la taille disponible quand le modèle change
  useEffect(() => {
    const m = imageModels.find(m => m.id === selectedModel);
    if (m && m.aspect_ratios && !m.aspect_ratios.includes(selectedAspectRatio)) {
      setSelectedAspectRatio(m.aspect_ratios[0]);
    }
  }, [selectedModel]);

  const loadGallery = () => {
    apiFetch(ROUTES.image.list)
      .then(r => r.json())
      .then(d => setGallery(d.images || []))
      .catch(() => {});
  };

  const handleEnhance = async () => {
    if (!prompt.trim()) return;
    setLoadingEnhance(true);
    setError(null);
    try {
      const r = await apiFetch(ROUTES.image.enhancePrompt, {
        method: 'POST',
        body: JSON.stringify({ prompt: prompt.trim(), model: enhanceModel }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setPrompt(d.enhanced);
      // Focus textarea + scroll en bas
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(d.enhanced.length, d.enhanced.length);
        }
      }, 50);
    } catch (e) {
      setError(`Erreur amélioration : ${e.message}`);
    } finally {
      setLoadingEnhance(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModel) return;
    setLoadingGenerate(true);
    setError(null);
    try {
      const r = await apiFetch(ROUTES.image.generate, {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          model: selectedModel,
          aspect_ratio: selectedAspectRatio,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || r.statusText);
      }
      await r.json();
      loadGallery();
    } catch (e) {
      setError(`Erreur génération : ${e.message}`);
    } finally {
      setLoadingGenerate(false);
    }
  };

  const handleDelete = async (id) => {
    await apiFetch(ROUTES.image.delete(id), { method: 'DELETE' });
    setGallery(prev => prev.filter(img => img.id !== id));
    if (lightbox?.id === id) setLightbox(null);
  };

  const currentModel = imageModels.find(m => m.id === selectedModel);

  return (
    <div className="is-root">

      {/* ── Panneau prompt ─────────────────────────────────────── */}
      <div className="is-prompt-panel">
        <div className="is-prompt-header">
          <span className="is-title">Image Studio</span>
        </div>

        <textarea
          ref={textareaRef}
          className="is-textarea"
          placeholder="Décris l'image à générer…"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={5}
        />

        {/* Contrôles amélioration */}
        <div className="is-enhance-row">
          <select
            className="is-select"
            value={enhanceModel}
            onChange={e => setEnhanceModel(e.target.value)}
          >
            {ENHANCE_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            className="is-btn is-btn-enhance"
            onClick={handleEnhance}
            disabled={loadingEnhance || !prompt.trim()}
          >
            {loadingEnhance ? '⏳ Amélioration…' : '✨ Améliorer'}
          </button>
        </div>

        <div className="is-divider" />

        {/* Contrôles génération */}
        <div className="is-gen-controls">
          <div className="is-field">
            <label className="is-label">Modèle image</label>
            <select
              className="is-select"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              {imageModels.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="is-field">
            <label className="is-label">Format</label>
            <select
              className="is-select"
              value={selectedAspectRatio}
              onChange={e => setSelectedAspectRatio(e.target.value)}
            >
              {(imageModels.find(m => m.id === selectedModel)?.aspect_ratios || ['1:1']).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="is-error">{error}</div>}

        <button
          className="is-btn is-btn-generate"
          onClick={handleGenerate}
          disabled={loadingGenerate || !prompt.trim() || !selectedModel}
        >
          {loadingGenerate
            ? <><span className="is-spinner" /> Génération en cours…</>
            : '🎨 Générer'}
        </button>
      </div>

      {/* ── Galerie ────────────────────────────────────────────── */}
      <div className="is-gallery">
        {gallery.length === 0 && !loadingGenerate && (
          <div className="is-gallery-empty">Aucune image générée pour l'instant</div>
        )}
        {loadingGenerate && (
          <div className="is-gallery-generating">
            <div className="is-gen-placeholder">
              <span className="is-spinner is-spinner-lg" />
              <span>Génération en cours…</span>
            </div>
          </div>
        )}
        {gallery.map(img => (
          <div key={img.id} className="is-thumb" onClick={() => setLightbox(img)}>
            <img
              src={img.url.startsWith('/api') ? `${API}${img.url}` : img.url}
              alt={img.prompt}
              loading="lazy"
            />
            <div className="is-thumb-overlay">
              <span className="is-thumb-model">{img.model.split('/')[1]}</span>
              <button
                className="is-thumb-delete"
                onClick={e => { e.stopPropagation(); handleDelete(img.id); }}
                title="Supprimer"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Lightbox ───────────────────────────────────────────── */}
      {lightbox && (
        <div className="is-lightbox" onClick={() => setLightbox(null)}>
          <div className="is-lightbox-inner" onClick={e => e.stopPropagation()}>
            <button className="is-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
            <img
              src={lightbox.url.startsWith('/api') ? `${API}${lightbox.url}` : lightbox.url}
              alt={lightbox.prompt}
            />
            <div className="is-lightbox-meta">
              <p className="is-lightbox-prompt">{lightbox.prompt}</p>
              <div className="is-lightbox-tags">
                <span>{lightbox.model.split('/')[1]}</span>
                <span>{lightbox.size}</span>
                <span>{new Date(lightbox.created_at).toLocaleString('fr-FR')}</span>
              </div>
              <div className="is-lightbox-actions">
                <a
                  href={lightbox.url.startsWith('/api') ? `${API}${lightbox.url}` : lightbox.url}
                  download={`image-${lightbox.id}.png`}
                  className="is-btn is-btn-dl"
                  onClick={e => e.stopPropagation()}
                >⬇ Télécharger</a>
                <button
                  className="is-btn is-btn-reuse"
                  onClick={() => { setPrompt(lightbox.prompt); setLightbox(null); }}
                >↩ Réutiliser le prompt</button>
                <button
                  className="is-btn is-btn-danger"
                  onClick={() => handleDelete(lightbox.id)}
                >🗑 Supprimer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
