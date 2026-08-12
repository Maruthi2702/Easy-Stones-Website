import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError() {
        // Update state so the next render will show the fallback UI.
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // You can also log the error to an error reporting service
        console.error("Uncaught error:", error, errorInfo);

        // Handle chunk/assets load failures (common after new deployments)
        const errorMessage = error && error.message ? error.message : '';
        if (errorMessage.includes('Failed to fetch dynamically imported module') ||
            errorMessage.includes('Importing a dynamically imported module failed') ||
            errorMessage.includes('Unable to preload CSS')) {
            console.log("Assets preload/chunk load failure detected, reloading page...");
            window.location.reload();
            return;
        }

        this.setState({ error, errorInfo });
    }

    render() {
        if (this.state.hasError) {
            // You can render any custom fallback UI
            return (
                <div style={{
                    padding: '2rem',
                    textAlign: 'center',
                    color: 'var(--text-primary, #e2e8f0)',
                    background: 'var(--bg-app, #0f172a)',
                    minHeight: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'inherit'
                }}>
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
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </div>
                    <h1 style={{ marginBottom: '1rem', color: '#ef4444', fontSize: '2rem', fontWeight: '800' }}>Something went wrong.</h1>
                    <p style={{ marginBottom: '2rem', maxWidth: '600px', color: 'var(--text-secondary, #94a3b8)', lineHeight: '1.6' }}>
                        The application encountered an unexpected error. Please try refreshing the page.
                    </p>
                    <details style={{
                        whiteSpace: 'pre-wrap',
                        background: 'var(--bg-card, #1c1c1e)',
                        padding: '1.25rem',
                        borderRadius: '12px',
                        textAlign: 'left',
                        maxWidth: '800px',
                        width: '100%',
                        overflow: 'auto',
                        maxHeight: '400px',
                        border: '1px solid var(--border-color, #334155)',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)'
                    }}>
                        <summary style={{ cursor: 'pointer', marginBottom: '0.75rem', color: '#d4af37', fontWeight: '600', outline: 'none' }}>Error Details</summary>
                        <strong style={{ color: '#ef4444', fontSize: '0.9rem' }}>{this.state.error && this.state.error.toString()}</strong>
                        <br />
                        <br />
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8em', color: 'var(--text-secondary, #cbd5e1)' }}>
                            {this.state.errorInfo && this.state.errorInfo.componentStack}
                        </span>
                    </details>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '2rem',
                            padding: '0.75rem 2rem',
                            background: 'linear-gradient(135deg, #d4af37, #b8961f)',
                            color: '#000000',
                            border: 'none',
                            borderRadius: '9px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '700',
                            boxShadow: '0 4px 15px rgba(212, 175, 55, 0.25)',
                            transition: 'all 0.2s ease',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-refresh-cw"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        <span>Refresh Page</span>
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
