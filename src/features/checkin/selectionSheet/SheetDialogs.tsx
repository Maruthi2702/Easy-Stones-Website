import React, { useEffect, useRef, useState } from 'react';
import { DollarSign, Mail, Printer, X } from 'lucide-react';

/*
 * Dialogs that open on top of the Selection Sheet. They sit inside the
 * FormModal (so its Tab trap finds them by data-fm-layer) and reuse its
 * confirm-dialog look; Esc closes the dialog, not the sheet. Nothing here
 * is a <form> — they live inside the sheet's form — so Enter is handled by
 * hand and never submits the sheet.
 */

/** What the sheet's prices look like: how many materials, whether any is priced, how many aren't. */
export type PriceSummary = { materials: number; any: boolean; missing: number };

function Layer({ labelledBy, onClose, className = '', children }: { labelledBy: string; onClose: () => void; className?: string; children?: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        // The marked button first (Print's main choice), else the first box or button.
        (el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>('input:not([type="range"]), button') || el)?.focus({ preventScroll: true });
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

// Title, the customer and how many materials, and the ✕ — the only way to
// close the Print and Email pop-ups (no Cancel: the ✕ already does that).
function DialogHead({ id, title, sub, onClose, disabled }: { id: string; title: string; sub?: string; onClose: () => void; disabled?: boolean }) {
    return (
        <div className="ss-dialog-head">
            <div className="ss-dialog-titles">
                <h3 className="fm-confirm-title" id={id}>{title}</h3>
                {sub && <p className="ss-dialog-sub">{sub}</p>}
            </div>
            <button type="button" className="ss-dialog-x" aria-label="Close" onClick={onClose} disabled={disabled}>
                <X size={18} aria-hidden="true" />
            </button>
        </div>
    );
}

const pricedLine = (summary: PriceSummary): string => (summary.missing
    ? `${summary.missing} material${summary.missing === 1 ? ' has' : 's have'} no price (prints “—”)`
    : 'Price / SF on each material');

// One big button per choice; pressing it does the thing (no separate confirm).
function Choice({ primary, icon, title, sub, warn, onClick, disabled, busy, autoFocus }: {
    primary?: boolean; icon: React.ReactNode; title: string; sub?: string; warn?: boolean;
    onClick: () => void; disabled?: boolean; busy?: boolean; autoFocus?: boolean;
}) {
    return (
        <button type="button" className={`ss-choice${primary ? ' ss-choice-primary' : ''}`} onClick={onClick} disabled={disabled} aria-busy={busy ? 'true' : undefined} data-autofocus={autoFocus ? '' : undefined}>
            <span className="ss-choice-icon" aria-hidden="true">{busy ? <span className="fm-spinner" /> : icon}</span>
            <span className="ss-choice-text">
                <span className="ss-choice-title">{title}</span>
                {sub && <span className={`ss-choice-sub${warn ? ' ss-choice-warn' : ''}`}>{sub}</span>}
            </span>
        </button>
    );
}

const materialsLine = (customer: string, summary: PriceSummary): string => [
    customer,
    summary.materials ? `${summary.materials} material${summary.materials === 1 ? '' : 's'}` : ''
].filter(Boolean).join(' · ');

/**
 * Print, when at least one material has a price: without (the customer's
 * copy, the main button) or with prices. With no prices on the sheet the
 * form prints straight away and this never opens.
 */
export function PrintDialog({ customer = '', summary, onPrint, onClose }: {
    customer?: string; summary: PriceSummary; onPrint: (withPrices: boolean) => void; onClose: () => void;
}) {
    return (
        <Layer labelledBy="ss-print-title" onClose={onClose} className="ss-dialog">
            <DialogHead id="ss-print-title" title="Print selection sheet" sub={materialsLine(customer, summary)} onClose={onClose} />
            <div className="ss-choices">
                <Choice primary autoFocus icon={<Printer size={20} />} title="Print without prices" sub="Customer copy" onClick={() => onPrint(false)} />
                <Choice icon={<DollarSign size={20} />} title="Print with prices" sub={pricedLine(summary)} warn={summary.missing > 0} onClick={() => onPrint(true)} />
            </div>
        </Layer>
    );
}

/** Who an emailed sheet is for: the home owner (the visitor) or their fabricator. */
export type EmailRecipient = 'owner' | 'fabricator';

/**
 * Email the sheet. First who it's for (owner, 2026-11-07, the "Selection
 * Sheet — customer copy" canvas): the **Home Owner** — their email filled in,
 * "Send without prices" the main button — or the **Fabricator** — the address
 * typed (a check-in keeps no fabricator email), "Send with prices" the main
 * button. Both send the same sheet; the other price choice is always there
 * while a material has a price. Each button sends straight away.
 */
export function EmailDialog({ initialTo = '', customer = '', fabricator = '', summary, savesFirst = false, sending = null, error = '', onSend, onClose }: {
    initialTo?: string; customer?: string; fabricator?: string; summary: PriceSummary; savesFirst?: boolean;
    /** Which button's send is running: 'plain' | 'priced' | null. */
    sending?: 'plain' | 'priced' | null; error?: string;
    onSend: (to: string, withPrices: boolean) => void; onClose: () => void;
}) {
    const [who, setWho] = useState<EmailRecipient>('owner');
    const [to, setTo] = useState(initialTo);
    const [tried, setTried] = useState(false);
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
    const send = (withPrices: boolean) => {
        setTried(true);
        if (valid && !sending) onSend(to.trim(), withPrices);
    };
    // Switching who it's for swaps the address that came with the choice; one
    // typed by hand stays.
    const pick = (next: EmailRecipient) => {
        if (next === who) return;
        setWho(next);
        setTried(false);
        const filled = who === 'owner' ? initialTo : '';
        if (to.trim() === filled.trim()) setTo(next === 'owner' ? initialTo : '');
    };
    const forFabricator = who === 'fabricator';
    const copy = forFabricator ? 'Fabricator copy' : 'Home owner copy';
    // The main button: with prices for a fabricator, without for a home owner.
    const pricedFirst = forFabricator && summary.any;
    const shownError = error || (tried && !valid ? 'Enter an email address like name@example.com' : '');
    const plain = (primary: boolean) => (
        <Choice
            key="plain"
            primary={primary}
            icon={<Mail size={20} />}
            title={sending === 'plain' ? 'Sending…' : (summary.any ? 'Send without prices' : 'Send email')}
            sub={copy}
            busy={sending === 'plain'}
            disabled={Boolean(sending)}
            onClick={() => send(false)}
        />
    );
    const priced = (primary: boolean) => (
        <Choice
            key="priced"
            primary={primary}
            icon={<DollarSign size={20} />}
            title={sending === 'priced' ? 'Sending…' : 'Send with prices'}
            sub={primary ? `${copy} · ${pricedLine(summary)}` : pricedLine(summary)}
            warn={!primary && summary.missing > 0}
            busy={sending === 'priced'}
            disabled={Boolean(sending)}
            onClick={() => send(true)}
        />
    );
    return (
        <Layer labelledBy="ss-email-title" onClose={sending ? () => {} : onClose} className="ss-dialog">
            <DialogHead id="ss-email-title" title="Email selection sheet" sub={materialsLine(customer, summary)} onClose={onClose} disabled={Boolean(sending)} />
            <div className="fm-field">
                <span className="fm-label" id="ss-email-who">Who is it for?</span>
                <div className="ss-who" role="group" aria-labelledby="ss-email-who">
                    <button type="button" className={`ss-who-opt${forFabricator ? '' : ' is-on'}`} aria-pressed={!forFabricator} disabled={Boolean(sending)} onClick={() => pick('owner')}>
                        <span className="ss-who-title">Home Owner</span>
                        <span className="ss-who-sub">{customer || '—'}</span>
                    </button>
                    <button type="button" className={`ss-who-opt${forFabricator ? ' is-on' : ''}`} aria-pressed={forFabricator} disabled={Boolean(sending)} onClick={() => pick('fabricator')}>
                        <span className="ss-who-title">Fabricator</span>
                        <span className="ss-who-sub">{fabricator || '—'}</span>
                    </button>
                </div>
            </div>
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
                    placeholder={forFabricator ? 'fabricator@email.com' : 'homeowner@email.com'}
                    disabled={Boolean(sending)}
                    aria-invalid={shownError ? 'true' : undefined}
                    onChange={(e) => setTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(pricedFirst); } }}
                />
                {shownError && <span className="fm-error" role="alert">{shownError}</span>}
            </div>
            {savesFirst && <p className="fm-confirm-text">Your unsaved changes are saved first, so the email matches what's on screen.</p>}
            <div className="ss-choices">
                {pricedFirst
                    ? [priced(true), plain(false)]
                    : [plain(true), ...(summary.any ? [priced(false)] : [])]}
            </div>
        </Layer>
    );
}
