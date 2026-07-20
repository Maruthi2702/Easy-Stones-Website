import React, { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("⚠️ React ErrorBoundary caught an unhandled component render crash:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          padding: '2.5rem',
          margin: '2rem auto',
          maxWidth: '600px',
          background: 'var(--bg-card, rgba(255, 255, 255, 0.05))',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          borderRadius: '16px',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
          color: 'var(--text-primary, #ffffff)',
          fontFamily: 'inherit'
        }} className="error-boundary-container">
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            marginBottom: '1.5rem'
          }}>
            <AlertTriangle size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.75rem', color: 'var(--text-primary, #f8fafc)' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.75rem' }}>
            An unexpected error occurred while loading this section. Please try resetting this view or refreshing the page.
          </p>
          {this.state.error && (
            <pre style={{
              textAlign: 'left',
              padding: '1rem',
              background: 'var(--bg-app, rgba(0, 0, 0, 0.2))',
              borderRadius: '8px',
              fontSize: '0.75rem',
              color: '#ef4444',
              overflowX: 'auto',
              maxHeight: '120px',
              marginBottom: '1.75rem',
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              {this.state.error.toString()}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #d4af37, #b8961f)',
              color: '#000000',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(212, 175, 55, 0.2)',
              transition: 'all 0.2s ease'
            }}
          >
            <RefreshCw size={14} />
            <span>Reset View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
