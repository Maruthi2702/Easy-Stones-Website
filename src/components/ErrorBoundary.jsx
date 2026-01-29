import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // You can also log the error to an error reporting service
        console.error("Uncaught error:", error, errorInfo);

        // Handle chunk load failures (common after new deployments)
        const errorMessage = error && error.message ? error.message : '';
        if (errorMessage.includes('Failed to fetch dynamically imported module') ||
            errorMessage.includes('Importing a dynamically imported module failed')) {
            console.log("Chunk load failure detected, reloading page...");
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
                    color: '#e2e8f0',
                    background: '#0f172a',
                    minHeight: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <h1 style={{ marginBottom: '1rem', color: '#ef4444' }}>Something went wrong.</h1>
                    <p style={{ marginBottom: '2rem', maxWidth: '600px' }}>
                        The application encountered an unexpected error. Please try refreshing the page.
                    </p>
                    <details style={{
                        whiteSpace: 'pre-wrap',
                        background: '#1e293b',
                        padding: '1rem',
                        borderRadius: '0.5rem',
                        textAlign: 'left',
                        maxWidth: '800px',
                        width: '100%',
                        overflow: 'auto',
                        maxHeight: '400px',
                        border: '1px solid #334155'
                    }}>
                        <summary style={{ cursor: 'pointer', marginBottom: '0.5rem', color: '#94a3b8' }}>Error Details</summary>
                        <strong style={{ color: '#f87171' }}>{this.state.error && this.state.error.toString()}</strong>
                        <br />
                        <br />
                        <span style={{ fontFamily: 'monospace', fontSize: '0.9em', color: '#cbd5e1' }}>
                            {this.state.errorInfo && this.state.errorInfo.componentStack}
                        </span>
                    </details>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '2rem',
                            padding: '0.75rem 1.5rem',
                            background: '#007AFF',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.375rem',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            fontWeight: '600'
                        }}
                    >
                        Refresh Page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
