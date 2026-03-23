import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Erreur non rattrapée:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const msg = this.props.message || 'Une erreur inattendue s\'est produite.';
      return (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          fontFamily: 'sans-serif',
          color: '#333',
        }}>
          <h2 style={{ color: '#c0392b' }}>Erreur application</h2>
          <p>{msg}</p>
          <pre style={{
            background: '#f8f8f8',
            padding: '12px',
            borderRadius: '4px',
            fontSize: '12px',
            textAlign: 'left',
            maxWidth: '600px',
            margin: '16px auto',
            overflow: 'auto',
          }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              background: '#4a90e2',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
