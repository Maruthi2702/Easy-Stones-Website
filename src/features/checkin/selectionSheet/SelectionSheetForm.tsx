import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, Lock, Mail, MoreHorizontal, Plus, Printer, Trash2, X } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { useSalesRepOptions } from '../../../api/salesRepOptions';
import { formatInstant } from '../../../utils/dateUtils';
import { letterheadFor } from '../../../utils/locationForm';
import {
    SHEET_ROWS, emptyRow, sheetValuesFromCheckIn, countSheetChanges, sheetPayload,
    buildSelectionSheetHtml, formatSlabSize, sheetPriceErrors, sheetPriceSummary, PRICE_ERROR,
    type SheetValues, type SheetCheckIn
} from '../../../utils/selectionSheet';
import SheetMaterials, { type RowNotice } from './SheetMaterials';
import type { Loose } from '../../../types/records';
import RepPicker from '../../../components/shared/form/RepPicker';
import { EmailDialog, PrintDialog } from './SheetDialogs';
import { placeTagRows } from '../../../utils/tagLine';
import './SelectionSheetForm.css';

/*
 * Check-In Log → a visit's clipboard button. On the shared form template
 * (FORM_TEMPLATE.md), size L; approved design: the "Selection Sheet" canvas
 * (claude.ai/artifact/VjjzPT6QRMaDWa3G9WVCCd).
 *
 *  - Desktop/tablet: visit details as read-only fields + Sales rep, a
 *    materials table (with an optional price per SF), internal notes beside
 *    printed notes; Email · Print on the left of the footer.
 *  - Phones: just Sales rep, one thin card per material, internal notes then
 *    printed notes, and Save at the end of the form (no footer); Email ·
 *    Print under "…" in the header.
 *  - Print / Email: when a material has a price, a pop-up offers "…without
 *    prices" (the customer's copy) or "…with prices"; each acts at once.
 *    Internal notes are never printed or emailed.
 *
 * Rules (rows, change count, PUT body, who can be the rep, the print page)
 * are src/utils/selectionSheet.js. The PUT carries the updatedAt this sheet
 * was loaded at; if someone saved since, the server answers 409 and the
 * person chooses whose version to keep. Unsaved work is kept as a draft in
 * localStorage for this user, so a refresh doesn't lose it.
 */

export const SHEET_DRAFT_KEY = 'active_selection_sheet';
const UNREADABLE = 'Unable to read the tag. Try again a little closer, with the tag in focus.';

/** Unsaved work kept for its owner, so a refresh reopens it. */
export type SheetDraft = { owner: string; checkIn: SheetCheckIn; values: SheetValues; loadedAt: string | null };

export type SelectionSheetFormProps = {
    checkIn: SheetCheckIn;
    draft?: Loose | null;
    /** Who is editing: the draft's owner, and "(you)" in the rep list. */
    owner: string;
    /** Location documents (for the letterhead) or names. */
    locations?: unknown[];
    canEdit: boolean;
    canEmail: boolean;
    onClose: () => void;
    onSaved?: (saved: SheetCheckIn) => void;
};

export default function SelectionSheetForm({ checkIn, draft = null, owner, locations = [], canEdit, canEmail, onClose, onSaved }: SelectionSheetFormProps) {
    const isPhone = useIsPhone();
    const [record, setRecord] = useState(checkIn);
    const baseline = useMemo(() => sheetValuesFromCheckIn(record), [record]);
    const [values, setValues] = useState<SheetValues>(() => draft?.values || sheetValuesFromCheckIn(checkIn));
    // A tag scan takes seconds; it places its rows against the sheet as it is when it finishes.
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const [loadedAt, setLoadedAt] = useState<string | null>(() => draft?.loadedAt || checkIn.updatedAt || null);

    const [products, setProducts] = useState<Loose[]>([]);
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState('');
    const [formError, setFormError] = useState('');
    const [conflict, setConflict] = useState<SheetCheckIn | null>(null);
    const [notices, setNotices] = useState<Record<number, RowNotice>>({});
    const [scanning, setScanning] = useState<{ idx: number; progress: number } | null>(null);
    const [emailOpen, setEmailOpen] = useState(false);
    const [printOpen, setPrintOpen] = useState(false);
    const [sending, setSending] = useState<'plain' | 'priced' | null>(null);
    // Rows whose price box has been left (or a save tried) — a price is only
    // marked wrong after that, not while "12." is still being typed.
    const [priceTouched, setPriceTouched] = useState<Record<number, boolean>>({});
    const [emailError, setEmailError] = useState('');
    const [moreOpen, setMoreOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const scanIdx = useRef<number | null>(null);
    const focusAfterAdd = useRef<number | null>(null);

    const dirty = canEdit ? countSheetChanges(values, baseline) : 0;
    const priceErrors = useMemo(() => sheetPriceErrors(values), [values]);
    const priceSummary = useMemo(() => sheetPriceSummary(values), [values]);
    const priceError = (i: number): string => (priceTouched[i] ? priceErrors[i] || '' : '');

    useEffect(() => {
        let alive = true;
        authFetch(`${API_URL}/api/products`)
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => { if (alive) setProducts(Array.isArray(d) ? d : (d?.data || [])); })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    // Unsaved work survives a refresh — for this person only (owner).
    useEffect(() => {
        try {
            if (dirty > 0) localStorage.setItem(SHEET_DRAFT_KEY, JSON.stringify({ owner, checkIn: record, values, loadedAt }));
            else localStorage.removeItem(SHEET_DRAFT_KEY);
        } catch { /* storage off — the sheet still works */ }
    }, [dirty, owner, record, values, loadedAt]);

    // A row added on a phone gets the cursor.
    useEffect(() => {
        if (focusAfterAdd.current == null) return;
        document.getElementById(`ss-mat-${focusAfterAdd.current}`)?.focus();
        focusAfterAdd.current = null;
    });

    const touch = () => { setNote(''); setFormError(''); };
    const setRow = (i: number, patch: Partial<SheetValues['rows'][number]>) => {
        touch();
        setValues((v) => ({ ...v, rows: v.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
    };
    const addRow = () => {
        if (values.rows.length >= SHEET_ROWS) return;
        touch();
        focusAfterAdd.current = values.rows.length;
        setValues((v) => ({ ...v, rows: [...v.rows, emptyRow()] }));
    };
    const removeRow = (i: number) => {
        // A tag scan writes its result to the row it started on, by position;
        // removing a row mid-scan would shift it onto a different item.
        if (scanning != null) return;
        touch();
        setNotices({});
        setPriceTouched({});
        setValues((v) => {
            const rows = v.rows.filter((_, j) => j !== i);
            return { ...v, rows: rows.length ? rows : [emptyRow()] };
        });
    };

    // The shared sales rep list (src/api/salesRepOptions.js): reps working at
    // this visit's branch. The sheet emails its rep on every change, so nobody
    // deactivated is offered (one already named here still shows, marked).
    const repList = useSalesRepOptions({
        branches: record.location ? [record.location] : [],
        current: { name: values.salesRep, email: values.salesRepEmail }
    });
    const chooseRep = (name: string) => {
        const opt = repList.find((o) => o.value === name);
        touch();
        setValues((v) => ({ ...v, salesRep: name, salesRepEmail: name ? (opt?.email || '') : '' }));
    };

    // PUT what's on screen. Returns 'saved' | 'conflict'; throws a message otherwise.
    const persist = async (expectedUpdatedAt: string | null): Promise<'saved' | 'conflict'> => {
        let res: Response;
        try {
            res = await authFetch(`${API_URL}/api/checkin/${record._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sheetPayload(values, expectedUpdatedAt))
            });
        } catch {
            throw new Error('Couldn’t reach the server. Check your connection and try again.');
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.data) {
            setConflict(data.data);
            return 'conflict';
        }
        // Our routes answer { message }, but sign-in and permission checks
        // answer { error }, and an outage answers an HTML page — say which,
        // so "try again" isn't the only clue.
        if (!res.ok) throw new Error(data.message || data.error || `Couldn’t save this sheet (error ${res.status}). Try again.`);
        const saved = data.data || record;
        setRecord(saved);
        setValues(sheetValuesFromCheckIn(saved));
        setLoadedAt(saved.updatedAt || null);
        setConflict(null);
        setNotices({});
        onSaved?.(saved);
        return 'saved';
    };

    // A price that can't be read would otherwise be saved as no price. → the
    // first bad row's number, or 0 when every price is fine.
    // (Not focused from the Email pop-up — the box is behind it.)
    const firstBadPrice = ({ focus = true }: { focus?: boolean } = {}): number => {
        const bad = Object.keys(priceErrors).map(Number).sort((a, b) => a - b);
        if (!bad.length) return 0;
        setPriceTouched((t) => ({ ...t, ...Object.fromEntries(bad.map((i) => [i, true])) }));
        if (focus) document.getElementById(`ss-price-${bad[0]}`)?.focus();
        return bad[0] + 1;
    };

    const save = async (expectedUpdatedAt: string | null = loadedAt) => {
        if (!canEdit || saving) return;
        const bad = firstBadPrice();
        if (bad) { setFormError(`${PRICE_ERROR} (item ${bad}).`); return; }
        setSaving(true);
        setFormError('');
        try {
            // Saved → done with this sheet: close it (the log refreshes via
            // onSaved). A conflict or an error keeps it open with what's typed.
            if ((await persist(expectedUpdatedAt)) === 'saved') onClose?.();
        } catch (err) {
            setFormError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const loadTheirs = () => {
        if (!conflict) return;
        setPriceTouched({});
        setRecord(conflict);
        setValues(sheetValuesFromCheckIn(conflict));
        setLoadedAt(conflict.updatedAt || null);
        setConflict(null);
        setNotices({});
    };

    const sendEmail = async (to: string, withPrices: boolean) => {
        setEmailError('');
        if (canEdit && dirty > 0) {
            const bad = firstBadPrice({ focus: false });
            if (bad) { setEmailError(`Fix the price on item ${bad} first. ${PRICE_ERROR}.`); return; }
        }
        setSending(withPrices ? 'priced' : 'plain');
        try {
            if (canEdit && dirty > 0) {
                const result = await persist(loadedAt);
                if (result === 'conflict') { setEmailOpen(false); return; }
            }
            const res = await authFetch(`${API_URL}/api/checkin/${record._id}/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: to, withPrices })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setEmailError(data.message || data.error || `Couldn’t send the email (error ${res.status}). Try again.`); return; }
            setEmailOpen(false);
            setNote(`✓ Emailed to ${to}${withPrices ? ' with prices' : ''}`);
        } catch (err) {
            setEmailError((err as Error).message || 'Couldn’t send the email. Try again.');
        } finally {
            setSending(null);
        }
    };

    // What's on screen, saved or not. With prices, every price has to read.
    const printSheet = (showPrices: boolean) => {
        setPrintOpen(false);
        if (showPrices) {
            const bad = firstBadPrice();
            if (bad) { setFormError(`${PRICE_ERROR} (item ${bad}).`); return; }
        }
        const location = (Array.isArray(locations) ? locations : []).find((l): l is Loose => Boolean(l) && typeof l === 'object' && (l as Loose).name === record.location);
        const html = buildSelectionSheetHtml({ checkIn: record, dateStr: formatInstant(record.createdAt), values, letterhead: letterheadFor(location), showPrices });
        const win = window.open('', '_blank', 'width=800,height=800');
        if (!win) { setFormError('Your browser blocked the print window. Allow pop-ups for this site, then try again.'); return; }
        win.document.write(html);
        win.document.close();
    };
    // No price anywhere → nothing to choose, so print straight away.
    const print = () => {
        setMoreOpen(false);
        if (priceSummary.any) setPrintOpen(true);
        else printSheet(false);
    };

    // ── Tag scanning: scan icon → camera → photo → rows filled ──
    // The tags' barcodes find each printed line; one row per lot, its slabs
    // together (readTagPhoto, src/utils/tagLine.js). Nothing to frame or confirm.
    const startScan = (i: number) => { scanIdx.current = i; fileRef.current?.click(); };
    const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        const idx = scanIdx.current;
        if (!file || idx == null) return;
        setScanning({ idx, progress: 0 });
        setNotices((n) => ({ ...n, [idx]: null }));
        try {
            const { readTagPhoto } = await import('./readTagPhoto');
            const result = await readTagPhoto(file, products, (progress) => setScanning({ idx, progress }));
            if (!result.ok) {
                setNotices((n) => ({ ...n, [idx]: { tone: 'error', lines: [UNREADABLE] } }));
                return;
            }
            const scanned = result.rows.map((r) => ({ ...r, size: r.size ? formatSlabSize(r.size) : '' }));
            const placed = placeTagRows(valuesRef.current.rows, idx, scanned, SHEET_ROWS, emptyRow);
            touch();
            setValues((v) => ({ ...v, rows: placed.rows as SheetValues['rows'] }));
            const extra = [
                result.unread ? `${result.unread} tag${result.unread === 1 ? '' : 's'} in the photo couldn’t be read.` : '',
                placed.dropped ? `${placed.dropped} more lot${placed.dropped === 1 ? '' : 's'} didn’t fit — the sheet holds ${SHEET_ROWS} items.` : '',
            ].filter(Boolean);
            setNotices((n) => {
                const next = { ...n };
                placed.filled.forEach((at, k) => {
                    const lines = ['Filled from the tag — check it before saving.', ...scanned[k].notes, ...(k === 0 ? extra : [])];
                    next[at] = { tone: lines.length > 1 ? 'warn' : 'ok', lines };
                });
                return next;
            });
        } catch (err) {
            console.error('Tag scan failed:', err);
            setNotices((n) => ({ ...n, [idx]: { tone: 'error', lines: [UNREADABLE] } }));
        } finally {
            setScanning(null);
        }
    };


    // Customer and their phone under the title — on phones only, where the
    // body doesn't show the visit details (desktop/tablet list them in the
    // body, so repeating them up here is noise). Not the company too: two
    // names side by side read as two people.
    const customerLine = isPhone
        ? [record.name, record.phone].map((s) => String(s || '').trim()).filter(Boolean).join(' • ')
        : '';
    const title = (
        <span className="ss-title">
            <span className="ss-title-main">Selection Sheet{record.location ? ` - ${record.location}` : ''}</span>
            {customerLine && <span className="ss-title-sub">{customerLine}</span>}
        </span>
    );

    const headerActions = isPhone ? (
        <div className="ss-more">
            <button type="button" className="ss-more-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                <MoreHorizontal size={20} aria-hidden="true" />
            </button>
            {moreOpen && (
                <div className="ss-more-menu" role="menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false); } }}>
                    {canEmail && (
                        <button type="button" role="menuitem" className="ss-more-item" onClick={() => { setMoreOpen(false); setEmailError(''); setEmailOpen(true); }}>
                            <Mail size={18} aria-hidden="true" />Email
                        </button>
                    )}
                    <button type="button" role="menuitem" className="ss-more-item" onClick={print}>
                        <Printer size={18} aria-hidden="true" />Print
                    </button>
                </div>
            )}
        </div>
    ) : null;

    const footerStart = (
        <span className="ss-foot-actions">
            {canEmail && (
                <button type="button" className="fm-btn" onClick={() => { setEmailError(''); setEmailOpen(true); }} disabled={saving}>
                    <Mail size={16} aria-hidden="true" />Email
                </button>
            )}
            <button type="button" className="fm-btn" onClick={print} disabled={saving}>
                <Printer size={16} aria-hidden="true" />Print
            </button>
        </span>
    );
    const footerNote = formError
        ? <span className="fm-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{formError}</span>
        : note
            ? <span className="ss-saved-note">{note}</span>
            : (!canEdit ? 'View only — you can’t edit selection sheets' : null);

    const fact = (label: string, value: unknown) => (
        <div className="fm-field">
            <span className="fm-label">{label}</span>
            <span className="ss-fact">{(value as React.ReactNode) || '—'}</span>
        </div>
    );

    return (
        <FormModal
            title={title}
            size="l"
            onClose={onClose}
            onSubmit={canEdit ? () => save() : onClose}
            submitLabel={canEdit ? 'Save selection' : 'Close'}
            savingLabel="Saving…"
            saving={saving}
            submitDisabled={canEdit && dirty === 0}
            dirtyCount={dirty}
            discardTitle="Discard your changes?"
            footerStart={footerStart}
            footerNote={footerNote}
            headerActions={headerActions}
            hideFooterOnPhone
        >
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />

            {conflict && (
                <div className="ss-conflict" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <div className="ss-conflict-body">
                        <strong>Someone else saved this sheet while you had it open.</strong>
                        <div className="ss-conflict-actions">
                            <button type="button" className="fm-btn fm-btn-small" onClick={loadTheirs}>Load their version</button>
                            <button type="button" className="fm-btn fm-btn-small fm-btn-primary" onClick={() => save(conflict.updatedAt)}>Save mine over it</button>
                        </div>
                    </div>
                </div>
            )}

            <section className="fm-section">
                {!isPhone && (
                    <div className="ss-facts">
                        {fact('Date', formatInstant(record.createdAt))}
                        {fact('Customer', record.name)}
                        {fact('Phone', record.phone)}
                        {fact('Company', record.fabricatorCompany)}
                        {fact('Company phone', record.fabricatorPhone)}
                        <FormField name="salesRep" id="ss-rep" label="Sales rep">
                            <RepPicker id="ss-rep" value={values.salesRep} onChange={chooseRep} options={repList} noneLabel="None" you={owner} disabled={!canEdit} />
                        </FormField>
                    </div>
                )}
                {isPhone && (
                    <FormField name="salesRep" id="ss-rep" label="Sales rep">
                        <RepPicker id="ss-rep" value={values.salesRep} onChange={chooseRep} options={repList} noneLabel="None" you={owner} disabled={!canEdit} />
                    </FormField>
                )}
            </section>

            <section className="fm-section">
                <SheetMaterials
                    rows={values.rows}
                    products={products}
                    canEdit={canEdit}
                    isPhone={isPhone}
                    scanning={scanning}
                    notices={notices}
                    priceError={priceError}
                    onRowChange={setRow}
                    onPriceLeft={(i) => setPriceTouched((t) => ({ ...t, [i]: true }))}
                    onRemove={removeRow}
                    onAdd={addRow}
                    onScan={startScan}
                    onDismissNotice={(i) => setNotices((m) => ({ ...m, [i]: null }))}
                />
            </section>

            <section className="fm-section">
                <div className="ss-notes-grid">
                    <FormField name="internalNotes" id="ss-internal" label={<span className="ss-note-label"><Lock size={14} aria-hidden="true" />Internal notes</span>}>
                        <textarea
                            id="ss-internal"
                            className="fm-input ss-notes ss-notes-internal"
                            rows={4}
                            value={values.internalNotes}
                            placeholder="Staff only, never printed or sent to the customer…"
                            disabled={!canEdit}
                            onChange={(e) => { touch(); setValues((v) => ({ ...v, internalNotes: e.target.value })); }}
                        />
                    </FormField>
                    <FormField name="specialNotes" id="ss-notes" label={<span className="ss-note-label"><Printer size={14} aria-hidden="true" />Printed notes</span>}>
                        <textarea
                            id="ss-notes"
                            className="fm-input ss-notes"
                            rows={4}
                            value={values.specialNotes}
                            placeholder="Shown on the printed and emailed sheet…"
                            disabled={!canEdit}
                            onChange={(e) => { touch(); setValues((v) => ({ ...v, specialNotes: e.target.value })); }}
                        />
                    </FormField>
                </div>
                <div className="ss-policy">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <p>Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.</p>
                </div>
                {isPhone && canEdit && (
                    <button type="submit" className="fm-btn fm-btn-primary ss-phone-save" disabled={saving || dirty === 0} aria-busy={saving ? 'true' : undefined}>
                        {saving ? <><span className="fm-spinner" aria-hidden="true" />Saving…</> : 'Save selection'}
                    </button>
                )}
                {isPhone && footerNote && <p className="ss-phone-note">{footerNote}</p>}
            </section>

            {emailOpen && (
                <EmailDialog
                    initialTo={record.email || ''}
                    customer={record.name || ''}
                    summary={priceSummary}
                    savesFirst={canEdit && dirty > 0}
                    sending={sending}
                    error={emailError}
                    onSend={sendEmail}
                    onClose={() => setEmailOpen(false)}
                />
            )}
            {printOpen && (
                <PrintDialog
                    customer={record.name || ''}
                    summary={priceSummary}
                    onPrint={printSheet}
                    onClose={() => setPrintOpen(false)}
                />
            )}
        </FormModal>
    );
}
