import React, { useState } from 'react';
import { Mail, Send, Check, AlertCircle, Loader2 } from 'lucide-react';

/**
 * Send the report as a PDF attachment.
 *
 * Recipients are typed freely — comma, semicolon or space separated — because
 * the people who need this are a manager and a director, not a contact list
 * worth maintaining. The server validates and de-duplicates them again; this
 * only stops the obvious mistakes before a round trip.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parse = (raw) =>
  [...new Set(String(raw || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];

const EmailReportDialog = ({ open, onClose, onSend, title, subtitle, filename }) => {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);

  if (!open) return null;

  const addresses = parse(to);
  const invalid = addresses.filter(a => !EMAIL_RE.test(a));
  const valid = addresses.filter(a => EMAIL_RE.test(a));

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await onSend({ to: valid, message: message.trim() });
      setSentTo(result.sent || valid);
    } catch (err) {
      setError(err.message || 'Could not send the report.');
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    setTo(''); setMessage(''); setError(null); setSentTo(null);
    onClose();
  };

  return (
    <div className="dr-confirm-backdrop" onClick={sending ? undefined : close}>
      <div className="dr-confirm dr-confirm--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dr-confirm-badge"><Mail size={20} /></div>

        {sentTo ? (
          <>
            <h4>Sent</h4>
            <p>
              {filename} is on its way to {sentTo.length === 1 ? sentTo[0] : `${sentTo.length} recipients`}.
            </p>
            {sentTo.length > 1 && <p className="dr-sent-list">{sentTo.join(', ')}</p>}
            <div className="dr-confirm-actions">
              <button type="button" className="dr-btn dr-btn--gold" onClick={close}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h4>{title}</h4>
            <p>{subtitle} It goes as a PDF attachment — <strong>{filename}</strong>.</p>

            <label className="dr-confirm-label" htmlFor="dr-email-to">
              Send to <span className="dr-req">*</span>
            </label>
            <input
              id="dr-email-to"
              className="dr-cell is-left no-capitalize"
              style={{ width: '100%' }}
              value={to}
              autoFocus
              disabled={sending}
              placeholder="manager@easystones.com, ceo@easystones.com"
              onChange={(e) => setTo(e.target.value)}
            />
            <p className="dr-field-hint">
              {invalid.length > 0
                ? <span className="dr-hint-bad">{invalid.join(', ')} {invalid.length === 1 ? 'is not' : 'are not'} a valid address</span>
                : valid.length > 0
                  ? `${valid.length} recipient${valid.length === 1 ? '' : 's'}`
                  : 'Separate several with commas.'}
            </p>

            <label className="dr-confirm-label" htmlFor="dr-email-msg">Message <span className="dr-optional">optional</span></label>
            <textarea
              id="dr-email-msg"
              className="dr-notes no-capitalize dr-email-msg"
              value={message}
              disabled={sending}
              placeholder="Anything you want to say alongside it."
              onChange={(e) => setMessage(e.target.value)}
            />

            {error && (
              <div className="dr-error" style={{ marginTop: '.6rem', marginBottom: 0 }}>
                <AlertCircle size={15} /> <span>{error}</span>
              </div>
            )}

            <div className="dr-confirm-actions">
              <button type="button" className="dr-btn" onClick={close} disabled={sending}>Cancel</button>
              <button
                type="button"
                className="dr-btn dr-btn--gold"
                onClick={send}
                disabled={sending || valid.length === 0 || invalid.length > 0}
              >
                {sending ? <><Loader2 size={14} className="dr-spin" /> Sending…</> : <><Send size={14} /> Send</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EmailReportDialog;
