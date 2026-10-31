import './AuthRecovery.css';

/** A temporary verification failure is recoverable without signing in again. */
export default function AuthRecovery({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="auth-recovery">
            <section role="alert" aria-label="Session verification unavailable">
                <h1>Connection interrupted</h1>
                <p>{message}</p>
                <button type="button" onClick={onRetry}>Retry</button>
            </section>
        </div>
    );
}
