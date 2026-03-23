import { useState } from 'react';
import { api } from '../api';
import './LoginPage.css';

export default function LoginPage({ onLogin }) {
  const [login,    setLogin]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!login.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const user = await api.login(login.trim(), password);
      onLogin(user);
    } catch (err) {
      setError(err.message || 'Identifiants incorrects');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      <div className="login-bg" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className={`login-orb orb-${i}`} />
        ))}
      </div>

      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-icon">⚖</span>
          <span className="login-logo-text">LLM Council</span>
        </div>

        <h1 className="login-title">Connexion</h1>
        <p className="login-subtitle">Accédez à votre espace de travail</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="login-input">Identifiant</label>
            <input
              id="login-input"
              type="text"
              value={login}
              onChange={e => setLogin(e.target.value)}
              placeholder="votre.identifiant"
              autoComplete="username"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="password-input">Mot de passe</label>
            <input
              id="password-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="login-error" role="alert">
              <span>⚠</span> {error}
            </div>
          )}

          <button
            type="submit"
            className="login-btn"
            disabled={loading || !login.trim() || !password}
          >
            {loading ? <span className="login-spinner" /> : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
