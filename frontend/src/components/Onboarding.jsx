import { useState } from 'react';
import { apiFetch } from '../api';
import { ROUTES } from '../api/routes';
import './Onboarding.css';

const IMAGE_MODELS = [
  { id: 'black-forest-labs/flux-1.1-pro', name: 'Flux 1.1 Pro', desc: 'Meilleure qualité, détails fins' },
  { id: 'black-forest-labs/flux-schnell', name: 'Flux Schnell', desc: 'Rapide, bon rapport qualité/prix' },
  { id: 'stabilityai/stable-diffusion-3.5-large', name: 'Stable Diffusion 3.5', desc: 'Open source, polyvalent' },
  { id: 'x-ai/grok-2-vision', name: 'Grok 2 Vision', desc: 'xAI, créatif et précis' },
  { id: 'openai/dall-e-3', name: 'DALL-E 3', desc: 'OpenAI, excellent pour illustrations' },
];

const DEFAULT_GROUPS = [
  { id: 'general',  name: '🌍 Général',   desc: 'Usage quotidien, questions variées' },
  { id: 'writing',  name: '🖊️ Écriture',  desc: 'Rédaction, créativité, style' },
  { id: 'code',     name: '💻 Code',      desc: 'Développement, debugging, architecture' },
  { id: 'analysis', name: '🔬 Analyse',   desc: 'Recherche, fact-checking, raisonnement' },
];

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyStatus, setKeyStatus] = useState(null); // null | 'testing' | 'valid' | 'invalid'
  const [balance, setBalance] = useState(null);
  const [imageModel, setImageModel] = useState('black-forest-labs/flux-1.1-pro');
  const [defaultGroup, setDefaultGroup] = useState('general');
  const [saving, setSaving] = useState(false);

  const testKey = async () => {
    if (!apiKey.trim()) return;
    setKeyStatus('testing');
    try {
      const r = await apiFetch(ROUTES.preferences.testKey, {
        method: 'POST',
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      const data = await r.json();
      if (r.ok && data.valid) {
        setKeyStatus('valid');
        setBalance(data.balance);
      } else {
        setKeyStatus('invalid');
      }
    } catch {
      setKeyStatus('invalid');
    }
  };

  const finish = async () => {
    setSaving(true);
    await apiFetch(ROUTES.preferences.save, {
      method: 'PUT',
      body: JSON.stringify({
        username: username.trim(),
        openrouter_key: apiKey.trim(),
        image_model: imageModel,
        default_group: defaultGroup,
        onboarding_done: true,
      }),
    });
    setSaving(false);
    onComplete();
  };

  const canNext1 = keyStatus === 'valid';
  const canNext2 = !!imageModel;
  const canNext3 = !!defaultGroup;
  const canFinish = username.trim().length > 0;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">

        {/* Progress */}
        <div className="onboarding-progress">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`progress-dot${step >= s ? ' done' : ''}${step === s ? ' active' : ''}`} />
          ))}
        </div>

        {/* Step 1 — Clé API */}
        {step === 1 && (
          <div className="onboarding-step">
            <div className="step-icon">🔑</div>
            <h2>Clé OpenRouter</h2>
            <p>LLM Council utilise OpenRouter pour accéder aux modèles IA. Créez un compte gratuit sur <a href="https://openrouter.ai" target="_blank" rel="noreferrer">openrouter.ai</a> et copiez votre clé API.</p>
            <div className="key-input-row">
              <input
                className="onboarding-input"
                type="password"
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setKeyStatus(null); }}
                onKeyDown={e => e.key === 'Enter' && testKey()}
              />
              <button className="test-key-btn" onClick={testKey} disabled={!apiKey.trim() || keyStatus === 'testing'}>
                {keyStatus === 'testing' ? '⏳' : 'Tester'}
              </button>
            </div>
            {keyStatus === 'valid' && (
              <div className="key-status valid">✅ Clé valide — Solde disponible : ${balance?.toFixed(2)}</div>
            )}
            {keyStatus === 'invalid' && (
              <div className="key-status invalid">❌ Clé invalide ou erreur réseau</div>
            )}
            <div className="step-note">⚠️ La clé est stockée localement dans <code>data/preferences.json</code> — jamais envoyée ailleurs.</div>
          </div>
        )}

        {/* Step 2 — Modèle image */}
        {step === 2 && (
          <div className="onboarding-step">
            <div className="step-icon">🎨</div>
            <h2>Modèle image</h2>
            <p>Choisissez le modèle utilisé pour générer des illustrations depuis les synthèses du Chairman.</p>
            <div className="option-list">
              {IMAGE_MODELS.map(m => (
                <div
                  key={m.id}
                  className={`option-card${imageModel === m.id ? ' selected' : ''}`}
                  onClick={() => setImageModel(m.id)}
                >
                  <div className="option-name">{m.name}</div>
                  <div className="option-desc">{m.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — Groupe par défaut */}
        {step === 3 && (
          <div className="onboarding-step">
            <div className="step-icon">⚡</div>
            <h2>Groupe par défaut</h2>
            <p>Quel type d'usage est le plus courant pour vous ? Vous pourrez changer de groupe à tout moment.</p>
            <div className="option-list">
              {DEFAULT_GROUPS.map(g => (
                <div
                  key={g.id}
                  className={`option-card${defaultGroup === g.id ? ' selected' : ''}`}
                  onClick={() => setDefaultGroup(g.id)}
                >
                  <div className="option-name">{g.name}</div>
                  <div className="option-desc">{g.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4 — Profil */}
        {step === 4 && (
          <div className="onboarding-step">
            <div className="step-icon">👤</div>
            <h2>Votre prénom</h2>
            <p>Comment souhaitez-vous être appelé ?</p>
            <input
              className="onboarding-input large"
              type="text"
              placeholder="Ex: Romuald"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canFinish && finish()}
              autoFocus
            />
          </div>
        )}

        {/* Navigation */}
        <div className="onboarding-nav">
          {step > 1 && (
            <button className="nav-back" onClick={() => setStep(s => s - 1)}>← Retour</button>
          )}
          <div style={{ flex: 1 }} />
          {step < 4 && (
            <button
              className="nav-next"
              onClick={() => setStep(s => s + 1)}
              disabled={step === 1 ? !canNext1 : step === 2 ? !canNext2 : !canNext3}
            >
              Suivant →
            </button>
          )}
          {step === 4 && (
            <button className="nav-finish" onClick={finish} disabled={!canFinish || saving}>
              {saving ? 'Enregistrement...' : '🚀 Lancer LLM Council'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
