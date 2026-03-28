// Copyright 2026 LLM Council Project
import { useState, useEffect } from 'react';
import { api } from '../api';
import './ProfileModal.css';

export default function ProfileModal({ user, onClose, onUpdated }) {
  const [form,    setForm]    = useState({
    first_name: user.first_name || '',
    last_name:  user.last_name  || '',
    email:      user.email      || '',
  });
  const [pwForm,  setPwForm]  = useState({ password: '', confirm: '' });
  const [saving,  setSaving]  = useState(false);
  const [pwSaving,setPwSaving]= useState(false);
  const [saved,   setSaved]   = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [error,   setError]   = useState('');
  const [pwError, setPwError] = useState('');
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    api.me().then(setProfile).catch(() => {});
  }, []);

  const handleSave = async () => {
    setError(''); setSaving(true);
    try {
      await api.updateMe({
        first_name: form.first_name.trim(),
        last_name:  form.last_name.trim(),
        email:      form.email.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onUpdated?.();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleChangePassword = async () => {
    setPwError('');
    if (!pwForm.password) { setPwError('Mot de passe requis'); return; }
    if (pwForm.password !== pwForm.confirm) { setPwError('Les mots de passe ne correspondent pas'); return; }
    setPwSaving(true);
    try {
      await api.changePassword(pwForm.password);
      setPwSaved(true);
      setPwForm({ password: '', confirm: '' });
      setTimeout(() => setPwSaved(false), 2500);
    } catch (e) { setPwError(e.message); }
    finally { setPwSaving(false); }
  };

  const fmtDate = (iso) => iso ? iso.slice(0, 10) : '—';

  return (
    <div className="profile-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="profile-modal">
        <div className="profile-header">
          <div className="profile-avatar-lg">{user.login[0].toUpperCase()}</div>
          <div>
            <div className="profile-login">{user.login}</div>
            <div className="profile-role-badge">{user.role}</div>
          </div>
          <button className="profile-close" onClick={onClose}>✕</button>
        </div>

        <div className="profile-body">
          {/* Informations modifiables */}
          <section className="profile-section">
            <h4 className="profile-section-title">Mes informations</h4>
            <div className="profile-form-row">
              <div className="profile-field">
                <label>Prénom</label>
                <input value={form.first_name}
                  onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="Jean" />
              </div>
              <div className="profile-field">
                <label>Nom</label>
                <input value={form.last_name}
                  onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Dupont" />
              </div>
            </div>
            <div className="profile-field">
              <label>Email</label>
              <input type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="jean.dupont@entreprise.fr" />
            </div>
            {error && <div className="profile-error">⚠ {error}</div>}
            <button className="profile-btn-save" onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement…' : saved ? '✓ Enregistré' : 'Enregistrer'}
            </button>
          </section>

          {/* Changer mot de passe */}
          <section className="profile-section">
            <h4 className="profile-section-title">Changer le mot de passe</h4>
            <div className="profile-field">
              <label>Nouveau mot de passe</label>
              <input type="password" value={pwForm.password}
                onChange={e => setPwForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••" />
            </div>
            <div className="profile-field">
              <label>Confirmer</label>
              <input type="password" value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="••••••••" />
            </div>
            {pwError && <div className="profile-error">⚠ {pwError}</div>}
            <button className="profile-btn-save" onClick={handleChangePassword} disabled={pwSaving}>
              {pwSaving ? 'Enregistrement…' : pwSaved ? '✓ Mot de passe changé' : 'Changer le mot de passe'}
            </button>
          </section>

          {/* Informations en lecture seule */}
          <section className="profile-section profile-section-readonly">
            <h4 className="profile-section-title">Informations du compte</h4>
            <div className="profile-meta-grid">
              <span className="profile-meta-label">Login</span>
              <span className="profile-meta-value">{user.login}</span>
              <span className="profile-meta-label">Rôle</span>
              <span className="profile-meta-value">{user.role}</span>
              {profile?.departments?.length > 0 && (
                <>
                  <span className="profile-meta-label">Départements</span>
                  <span className="profile-meta-value">
                    {profile.departments.join(', ')}
                  </span>
                </>
              )}
              <span className="profile-meta-label">Créé le</span>
              <span className="profile-meta-value">{fmtDate(profile?.created_at)}</span>
              <span className="profile-meta-label">Dernière connexion</span>
              <span className="profile-meta-value">{fmtDate(profile?.last_login)}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
