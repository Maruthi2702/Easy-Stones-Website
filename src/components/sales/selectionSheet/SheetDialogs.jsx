import React, { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';

/*
 * Dialogs that open on top of the Selection Sheet. They sit inside the
 * FormModal (so its Tab trap finds them by data-fm-layer) and reuse its
 * confirm-dialog look; Esc closes the dialog, not the sheet. Nothing here
 * is a <form> — they live inside the sheet's form — so Enter is handled by
 * hand and never submits the sheet.
 */

function Layer({ labelledBy, onClose, className = '', children }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        (el?.querySelector('input:not([type="range"]), button') || el)?.focus({ preventScroll: true });
    }, []);
    return (
        <div className="fm-confirm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                ref={ref}
                className={`fm-confirm ${className}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                data-fm-layer=""
                tabIndex={-1}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
            >
                {children}
            </div>
        </div>
    );
}

export function EmailDialog({ initialTo = '', savesFirst = false, sending = false, error = '', onSend, onClose }) {
    const [to, setTo] = useState(initialTo);
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
    const send = () => { if (valid && !sending) onSend(to.trim()); };
    return (
        <Layer labelledBy="ss-email-title" onClose={sending ? () => {} : onClose}>
            <h3 className="fm-confirm-title" id="ss-email-title">Email selection sheet</h3>
            <div className="fm-field">
                <label className="fm-label" htmlFor="ss-email-to">Send to<span className="fm-req" aria-hidden="true">*</span></label>
                <input
                    id="ss-email-to"
                    className="fm-input no-capitalize"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={to}
                    placeholder="customer@email.com"
                    disabled={sending}
                    onChange={(e) => setTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                />
                {error && <span className="fm-error" role="alert">{error}</span>}
            </div>
            {savesFirst && <p className="fm-confirm-text">Your unsaved changes are saved first, so the email matches what's on screen.</p>}
            <div className="fm-confirm-actions">
                <button type="button" className="fm-btn fm-btn-cancel" onClick={onClose} disabled={sending}>Cancel</button>
                <button type="button" className="fm-btn fm-btn-primary" onClick={send} disabled={!valid || sending} aria-busy={sending ? 'true' : undefined}>
                    {sending ? <><span className="fm-spinner" aria-hidden="true" />Sending…</> : <><Mail size={16} aria-hidden="true" />Send email</>}
                </button>
            </div>
        </Layer>
    );
}

// Starts on the whole photo; the sliders tighten it around one tag.
const FULL = { x: 0, y: 0, width: 100, height: 100 };

export function TagCropper({ src, onScan, onClose }) {
    const [box, setBox] = useState(FULL);
    const slider = (key, label, min, max) => (
        <label className="ss-crop-control">
            <span>{label}: {box[key]}%</span>
            <input
                type="range"
                min={min}
                max={max}
                value={box[key]}
                onChange={(e) => setBox((b) => ({ ...b, [key]: parseInt(e.target.value, 10) }))}
            />
        </label>
    );
    return (
        <Layer labelledBy="ss-crop-title" onClose={onClose} className="ss-cropper">
            <h3 className="fm-confirm-title" id="ss-crop-title">Frame the slab tag</h3>
            <div className="ss-crop-stage">
                <div className="ss-crop-frame">
                    <img src={src} alt="The photo to scan" className="ss-crop-img" />
                    <div className="ss-crop-box" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }} />
                </div>
            </div>
            <div className="ss-crop-controls">
                {slider('x', 'Left', 0, 100 - box.width)}
                {slider('y', 'Top', 0, 100 - box.height)}
                {slider('width', 'Width', 10, 100 - box.x)}
                {slider('height', 'Height', 10, 100 - box.y)}
            </div>
            <div className="fm-confirm-actions">
                <button type="button" className="fm-btn fm-btn-cancel" onClick={onClose}>Cancel</button>
                <button type="button" className="fm-btn fm-btn-primary" onClick={() => onScan(box)}>Scan this area</button>
            </div>
        </Layer>
    );
}
