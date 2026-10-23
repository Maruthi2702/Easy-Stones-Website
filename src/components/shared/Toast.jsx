import React, { useEffect } from 'react';
import { Check, AlertTriangle, X } from 'lucide-react';
import './Toast.css';

/**
 * A short message at the bottom of the screen: "Visit saved", or what went
 * wrong. `toast` is { id, text, kind: 'ok' | 'error' } or null; a new id
 * restarts the timer. Errors stay longer and are announced at once.
 */
const Toast = ({ toast, onDismiss }) => {
  const id = toast?.id;
  const kind = toast?.kind;
  useEffect(() => {
    if (!id) return undefined;
    const t = setTimeout(onDismiss, kind === 'error' ? 9000 : 4000);
    return () => clearTimeout(t);
  }, [id, kind, onDismiss]);

  if (!toast) return null;
  const error = toast.kind === 'error';
  return (
    <div className={`app-toast${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <AlertTriangle size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
      <span className="app-toast-text">{toast.text}</span>
      <button type="button" className="app-toast-x" aria-label="Dismiss" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </div>
  );
};

export default Toast;
