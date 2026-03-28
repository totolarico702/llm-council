import { useState, useEffect } from 'react';
import { useModels } from '../modelsStore';
import { apiFetch } from '../api';
import { ROUTES } from '../api/routes';
import './SettingsPage.css';

const IMAGE_MODELS = [
  { id: 'black-forest-labs/flux-1.1-pro',               name: 'Flux 1.1 Pro',         desc: 'Meilleure qualité' },
  { id: 'black-forest-labs/flux-schnell',                name: 'Flux Schnell',          desc: 'Rapide & économique' },
  { id: 'stabilityai/stable-diffusion-3.5-large',        name: 'Stable Diffusion 3.5',  desc: 'Open source, polyvalent' },
  { id: 'x-ai/grok-2-vision',                            name: 'Grok 2 Vision',         desc: 'xAI, très créatif' },
  { id: 'openai/dall-e-3',                               name: 'DALL-E 3',              desc: 'OpenAI, illustrations' },
];

export default function SettingsPage({ onClose }) {
  const [prefs, setPrefs]           = useState(null);
  const [groups, setGroups]         = useState([]);
  const chairmanModels = useModels();
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [saveError, setSaveError]   = useState('');

  // Champs locaux
  const [username, setUsername]         = useState('');
  const [apiKey, setApiKey]             = useState('');
  const [keyStatus, setKeyStatus]       = useState(null); // null | testing | valid | invalid
  const [balance, setBalance]           = useState(null);
  const [chairmanModel, setChairmanModel] = useState('');
  const [imageModel, setImageModel]     = useState('');
  const [defaultGroup, setDefaultGroup] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch(ROUTES.preferences.get).then(r => r.json()),
      apiFetch(ROUTES.groups.list).then(r => r.json()),
    ]).then(([p, g]) => {
      setPrefs(p);
      setGroups(g);
      setUsername(p.username || '');
      setApiKey(p.openrouter_key || '');
      setChairmanModel(p.chairman_model || 'google/gemini-2.0-flash-001');
      setImageModel(p.image_model || 'black-forest-labs/flux-1.1-pro');
      setDefaultGroup(p.default_group || 'general');
      setLoading(false);
    });
  }, []);

  const testKey = async () => {
    if (!apiKey.trim()) return;
    setKeyStatus('testing');
    try {
      const r = await apiFetch(ROUTES.preferences.testKey, {
        method: 'POST',
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      const d = await r.json();
      if (r.ok && d.valid) { setKeyStatus('valid'); setBalance(d.balance); }
      else setKeyStatus('invalid');
    } catch { setKeyStatus('invalid'); }
  };

  const save = async () => {
    setSaving(true); setSaveError(''); setSaved(false);
    try {
      const r = await apiFetch(ROUTES.preferences.save, {
        method: 'PUT',
        body: JSON.stringify({
          username:       username.trim(),
          openrouter_key: apiKey.trim(),
          chairman_model: chairmanModel,
          image_model:    imageModel,
          default_group:  defaultGroup,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="sp-loading">Chargement des paramètres…</div>
  );

  return (
    <div className="sp-page">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-header-title">
          <span className="sp-header-icon">⚙️</span>
          Paramètres
        </div>
        <button className="sp-close-btn" onClick={onClose} title="Fermer">✕</button>
      </div>

      <div className="sp-content">

        {/* ── Section : Compte OpenRouter ── */}
        <section className="sp-section">
          <div className="sp-section-title">🔑 Compte OpenRouter</div>

          <div className="sp-field">
            <label className="sp-label">Prénom / Pseudo</label>
            <input
              className="sp-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Comment dois-je vous appeler ?"
            />
          </div>

          <div className="sp-field">
            <label className="sp-label">Clé API OpenRouter</label>
            <div className="sp-key-row">
              <input
                className="sp-input sp-input-key"
                type="password"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setKeyStatus(null); }}
                placeholder="sk-or-v1-..."
                autoComplete="off"
              />
              <button
                className="sp-btn-test"
                onClick={testKey}
                disabled={!apiKey.trim() || keyStatus === 'testing'}
              >
                {keyStatus === 'testing' ? '…' : 'Tester'}
              </button>
            </div>
            {keyStatus === 'valid' && (
              <div className="sp-key-status valid">
                ✓ Clé valide{balance !== null ? ` — Solde : $${Number(balance).toFixed(2)}` : ''}
              </div>
            )}
            {keyStatus === 'invalid' && (
              <div className="sp-key-status invalid">✗ Clé invalide ou réseau inaccessible</div>
            )}
          </div>
        </section>

        {/* ── Section : Modèles ── */}
        <section className="sp-section">
          <div className="sp-section-title">🧠 Modèles</div>

          <div className="sp-field">
            <label className="sp-label">Chairman par défaut</label>
            <p className="sp-field-hint">Le modèle qui synthétise les débats du council.</p>
            {chairmanModels.length > 0 ? (
              <select
                className="sp-select"
                value={chairmanModel}
                onChange={e => setChairmanModel(e.target.value)}
              >
                {!chairmanModels.find(m => m.id === chairmanModel) && (
                  <option value={chairmanModel}>{chairmanModel}</option>
                )}
                {chairmanModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id} {m.is_free ? '🆓' : m.cost_indicator || ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="sp-input"
                value={chairmanModel}
                onChange={e => setChairmanModel(e.target.value)}
                placeholder="google/gemini-2.0-flash-001"
              />
            )}
          </div>

          <div className="sp-field">
            <label className="sp-label">Modèle d'image</label>
            <p className="sp-field-hint">Utilisé pour la génération d'images (fonctionnalité à venir).</p>
            <div className="sp-option-grid">
              {IMAGE_MODELS.map(m => (
                <label
                  key={m.id}
                  className={`sp-option-card${imageModel === m.id ? ' active' : ''}`}
                >
                  <input
                    type="radio"
                    name="imageModel"
                    value={m.id}
                    checked={imageModel === m.id}
                    onChange={() => setImageModel(m.id)}
                  />
                  <div className="sp-option-name">{m.name}</div>
                  <div className="sp-option-desc">{m.desc}</div>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section : Interface ── */}
        <section className="sp-section">
          <div className="sp-section-title">🎛️ Interface</div>

          {/* Toggle anonymisation */}
          <div className="sp-field sp-field-row">
            <div>
              <label className="sp-label">🔒 Anonymisation des requêtes</label>
              <p className="sp-field-hint">Remplace noms, emails, tél, IPs… par des tokens avant envoi aux LLMs. Réinjectés automatiquement dans la réponse.</p>
            </div>
            <label className="sp-toggle">
              <input type="checkbox"
                checked={prefs.anonymize !== false}
                onChange={e => setPrefs(p => ({ ...p, anonymize: e.target.checked }))} />
              <span className="sp-toggle-track" />
            </label>
          </div>

          <div className="sp-field">
            <label className="sp-label">Pipeline par défaut</label>
            <p className="sp-field-hint">Chargé automatiquement à l'ouverture d'une nouvelle conversation.</p>
            <div className="sp-option-grid sp-option-grid-sm">
              {groups.map(g => (
                <label
                  key={g.id}
                  className={`sp-option-card${defaultGroup === g.id ? ' active' : ''}`}
                >
                  <input
                    type="radio"
                    name="defaultGroup"
                    value={g.id}
                    checked={defaultGroup === g.id}
                    onChange={() => setDefaultGroup(g.id)}
                  />
                  <div className="sp-option-name">{g.name}</div>
                </label>
              ))}
            </div>
          </div>
        </section>

      </div>

      {/* Footer */}
      <div className="sp-footer">
        {saveError && <div className="sp-save-error">{saveError}</div>}
        {saved && <div className="sp-save-ok">✓ Paramètres sauvegardés</div>}
        <div className="sp-footer-actions">
          <button className="sp-btn-cancel" onClick={onClose}>Fermer</button>
          <button className="sp-btn-save" onClick={save} disabled={saving}>
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}
