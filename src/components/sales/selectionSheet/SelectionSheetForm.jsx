import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, Mail, MoreHorizontal, Plus, Printer, Trash2, X } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormField, FormPicker } from '../../shared/form/FormControls';
import useIsPhone from '../../shared/form/useIsPhone';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { formatInstant } from '../../../utils/dateUtils';
import { letterheadFor } from '../../../utils/locationForm';
import {
    SHEET_ROWS, emptyRow, sheetValuesFromCheckIn, countSheetChanges, sheetPayload,
    salesRepOptions, buildSelectionSheetHtml
} from '../../../utils/selectionSheet';
import MaterialInput from './MaterialInput';
import { EmailDialog, TagCropper } from './SheetDialogs';
import { getCroppedImageBlob } from './tagImage';
import { scanTag } from './scanTag';
import './SelectionSheetForm.css';

/*
 * Check-In Log → a visit's clipboard button. On the shared form template
 * (FORM_TEMPLATE.md), size L; approved design: the "Selection Sheet" canvas
 * (claude.ai/artifact/VjjzPT6QRMaDWa3G9WVCCd).
 *
 *  - Desktop/tablet: visit details as read-only fields + Sales rep, a
 *    materials table, notes; Email · Print on the left of the footer.
 *  - Phones: just Sales rep, one thin card per material, notes, and Save at
 *    the end of the form (no footer); Email · Print under "…" in the header.
 *
 * Rules (rows, change count, PUT body, who can be the rep, the print page)
 * are src/utils/selectionSheet.js. The PUT carries the updatedAt this sheet
 * was loaded at; if someone saved since, the server answers 409 and the
 * person chooses whose version to keep. Unsaved work is kept as a draft in
 * localStorage for this user, so a refresh doesn't lose it.
 */

export const SHEET_DRAFT_KEY = 'active_selection_sheet';

export default function SelectionSheetForm({ checkIn, draft = null, owner, locations = [], canEdit, canEmail, onClose, onSaved }) {
    const isPhone = useIsPhone();
    const [record, setRecord] = useState(checkIn);
    const baseline = useMemo(() => sheetValuesFromCheckIn(record), [record]);
    const [values, setValues] = useState(() => draft?.values || sheetValuesFromCheckIn(checkIn));
    const [loadedAt, setLoadedAt] = useState(() => draft?.loadedAt || checkIn.updatedAt || null);

    const [products, setProducts] = useState([]);
    const [reps, setReps] = useState([]);
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState('');
    const [formError, setFormError] = useState('');
    const [conflict, setConflict] = useState(null);
    const [notices, setNotices] = useState({});
    const [scanning, setScanning] = useState(null); // { idx, progress }
    const [cropper, setCropper] = useState(null); // { idx, file, src }
    const [emailOpen, setEmailOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const [emailError, setEmailError] = useState('');
    const [moreOpen, setMoreOpen] = useState(false);
    const fileRef = useRef(null);
    const scanIdx = useRef(null);
    const focusAfterAdd = useRef(null);

    const dirty = canEdit ? countSheetChanges(values, baseline) : 0;

    useEffect(() => {
        let alive = true;
        authFetch(`${API_URL}/api/products`)
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => { if (alive) setProducts(Array.isArray(d) ? d : (d?.data || [])); })
            .catch(() => {});
        authFetch(`${API_URL}/api/salesreps`)
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => { if (alive) setReps(d?.success ? d.data : (Array.isArray(d) ? d : [])); })
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
    const setRow = (i, patch) => {
        touch();
        setValues((v) => ({ ...v, rows: v.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
    };
    const addRow = () => {
        if (values.rows.length >= SHEET_ROWS) return;
        touch();
        focusAfterAdd.current = values.rows.length;
        setValues((v) => ({ ...v, rows: [...v.rows, emptyRow()] }));
    };
    const removeRow = (i) => {
        // A tag scan writes its result to the row it started on, by position;
        // removing a row mid-scan would shift it onto a different item.
        if (scanning != null) return;
        touch();
        setNotices({});
        setValues((v) => {
            const rows = v.rows.filter((_, j) => j !== i);
            return { ...v, rows: rows.length ? rows : [emptyRow()] };
        });
    };

    const repOptions = useMemo(() => {
        const list = salesRepOptions(reps, record.location, { name: values.salesRep, email: values.salesRepEmail });
        return [{ value: '', label: 'None' }, ...list];
    }, [reps, record.location, values.salesRep, values.salesRepEmail]);
    const chooseRep = (name) => {
        const opt = repOptions.find((o) => o.value === name);
        touch();
        setValues((v) => ({ ...v, salesRep: name, salesRepEmail: name ? (opt?.email || '') : '' }));
    };

    // PUT what's on screen. Returns 'saved' | 'conflict'; throws a message otherwise.
    const persist = async (expectedUpdatedAt) => {
        let res;
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
        if (!res.ok) throw new Error(data.message || 'Couldn’t save this sheet. Try again.');
        const saved = data.data || record;
        setRecord(saved);
        setValues(sheetValuesFromCheckIn(saved));
        setLoadedAt(saved.updatedAt || null);
        setConflict(null);
        setNotices({});
        onSaved?.(saved);
        return 'saved';
    };

    const save = async (expectedUpdatedAt = loadedAt) => {
        if (!canEdit || saving) return;
        setSaving(true);
        setFormError('');
        try {
            if ((await persist(expectedUpdatedAt)) === 'saved') setNote('✓ Saved');
        } catch (err) {
            setFormError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const loadTheirs = () => {
        setRecord(conflict);
        setValues(sheetValuesFromCheckIn(conflict));
        setLoadedAt(conflict.updatedAt || null);
        setConflict(null);
        setNotices({});
    };

    const sendEmail = async (to) => {
        setSending(true);
        setEmailError('');
        try {
            if (canEdit && dirty > 0) {
                const result = await persist(loadedAt);
                if (result === 'conflict') { setEmailOpen(false); return; }
            }
            const res = await authFetch(`${API_URL}/api/checkin/${record._id}/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: to })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setEmailError(data.message || 'Couldn’t send the email. Try again.'); return; }
            setEmailOpen(false);
            setNote(`✓ Emailed to ${to}`);
        } catch (err) {
            setEmailError(err.message || 'Couldn’t send the email. Try again.');
        } finally {
            setSending(false);
        }
    };

    const print = () => {
        setMoreOpen(false);
        const location = (Array.isArray(locations) ? locations : []).find((l) => l && typeof l === 'object' && l.name === record.location);
        const html = buildSelectionSheetHtml({ checkIn: record, dateStr: formatInstant(record.createdAt), values, letterhead: letterheadFor(location) });
        const win = window.open('', '_blank', 'width=800,height=800');
        if (!win) { setFormError('Your browser blocked the print window. Allow pop-ups for this site, then try again.'); return; }
        win.document.write(html);
        win.document.close();
    };

    // ── Tag scanning: pick a photo → frame the tag → read it into the row ──
    const startScan = (i) => { scanIdx.current = i; fileRef.current?.click(); };
    const onPhoto = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || scanIdx.current == null) return;
        const reader = new FileReader();
        reader.onload = () => setCropper({ idx: scanIdx.current, file, src: reader.result });
        reader.readAsDataURL(file);
    };
    const runScan = async (box) => {
        const { idx, file } = cropper;
        setCropper(null);
        setScanning({ idx, progress: 0 });
        setNotices((n) => ({ ...n, [idx]: null }));
        try {
            const blob = await getCroppedImageBlob(file, box.x, box.y, box.width, box.height);
            const result = await scanTag(blob, products, (progress) => setScanning({ idx, progress }));
            if (!result.ok) {
                setNotices((n) => ({ ...n, [idx]: { tone: 'error', lines: [result.message] } }));
                return;
            }
            // Only what the tag gave; anything it didn't read stays as typed.
            setRow(idx, Object.fromEntries(Object.entries(result.row).filter(([, v]) => String(v || '').trim())));
            setNotices((n) => ({ ...n, [idx]: { tone: result.notes.length ? 'warn' : 'ok', lines: ['Filled from the tag — check it before saving.', ...result.notes] } }));
        } catch {
            setNotices((n) => ({ ...n, [idx]: { tone: 'error', lines: ['Couldn’t read that photo. Try another.'] } }));
        } finally {
            setScanning(null);
        }
    };

    const notice = (i) => {
        const n = notices[i];
        if (!n) return null;
        return (
            <div className={`ss-notice ss-notice-${n.tone}`} role="status">
                {n.tone === 'ok' ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                <div className="ss-notice-text">{n.lines.map((l) => <div key={l}>{l}</div>)}</div>
                <button type="button" className="ss-notice-close" aria-label="Dismiss" onClick={() => setNotices((m) => ({ ...m, [i]: null }))}>
                    <X size={12} aria-hidden="true" />
                </button>
            </div>
        );
    };

    const materialBox = (row, i) => (
        <MaterialInput
            id={`ss-mat-${i}`}
            value={row.material}
            onChange={(material) => setRow(i, { material })}
            products={products}
            disabled={!canEdit}
            ariaLabel={`Material, item ${i + 1}`}
            onScan={canEdit ? () => startScan(i) : undefined}
            scanning={scanning?.idx === i}
            progress={scanning?.idx === i ? scanning.progress : 0}
        />
    );
    const smallInput = (row, i, key, label, placeholder, inputMode) => (
        <input
            id={`ss-${key}-${i}`}
            className="fm-input no-capitalize"
            type="text"
            inputMode={inputMode}
            aria-label={`${label}, item ${i + 1}`}
            value={row[key]}
            placeholder={placeholder}
            disabled={!canEdit}
            onChange={(e) => setRow(i, { [key]: e.target.value })}
        />
    );
    const removeButton = (i) => (canEdit && values.rows.length > 1 ? (
        <button
            type="button"
            className="ss-remove"
            onClick={() => removeRow(i)}
            disabled={scanning != null}
            aria-label={`Remove item ${i + 1}`}
            title={scanning != null ? 'Wait for the tag scan to finish' : 'Remove this item'}
        >
            {isPhone ? <X size={15} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        </button>
    ) : <span className="ss-remove-spacer" aria-hidden="true" />);

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

    const fact = (label, value) => (
        <div className="fm-field">
            <span className="fm-label">{label}</span>
            <span className="ss-fact">{value || '—'}</span>
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
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />

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
                            <FormPicker id="ss-rep" value={values.salesRep} onChange={chooseRep} options={repOptions} placeholder="Choose a sales rep" sheetTitle="Sales rep" disabled={!canEdit} />
                        </FormField>
                    </div>
                )}
                {isPhone && (
                    <FormField name="salesRep" id="ss-rep" label="Sales rep">
                        <FormPicker id="ss-rep" value={values.salesRep} onChange={chooseRep} options={repOptions} placeholder="Choose a sales rep" sheetTitle="Sales rep" disabled={!canEdit} />
                    </FormField>
                )}
            </section>

            <section className="fm-section">
                {!isPhone ? (
                    <div className="ss-table">
                        <div className="ss-row ss-row-head" aria-hidden="true">
                            <span>#</span><span>Material</span>
                            <span className="ss-trio"><span>Lot #</span><span>Slabs</span><span>Size</span></span>
                            <span />
                        </div>
                        {values.rows.map((row, i) => (
                            <div className="ss-row" key={i}>
                                <span className="ss-row-num">{i + 1}</span>
                                <div className="ss-row-mat">{materialBox(row, i)}{notice(i)}</div>
                                <div className="ss-trio">
                                    {smallInput(row, i, 'lot', 'Lot or bundle number', '13845', 'numeric')}
                                    {smallInput(row, i, 'details', 'Slab numbers', '1, 2')}
                                    {smallInput(row, i, 'size', 'Size', '126 x 63')}
                                </div>
                                {removeButton(i)}
                            </div>
                        ))}
                        {canEdit && values.rows.length < SHEET_ROWS && (
                            <button type="button" className="fm-btn fm-btn-small ss-add-row" onClick={addRow}>
                                <Plus size={16} aria-hidden="true" />Add material row
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="ss-cards">
                        {values.rows.map((row, i) => (
                            <div className="ss-card" key={i}>
                                <div className="ss-card-top">
                                    <span className="ss-card-num" aria-hidden="true">{i + 1}</span>
                                    {materialBox(row, i)}
                                    {removeButton(i)}
                                </div>
                                {notice(i)}
                                <div className="ss-card-trio">
                                    <label className="ss-card-field"><span>Lot #</span>{smallInput(row, i, 'lot', 'Lot or bundle number', '—', 'numeric')}</label>
                                    <label className="ss-card-field"><span>Slabs</span>{smallInput(row, i, 'details', 'Slab numbers', '1, 2')}</label>
                                    <label className="ss-card-field"><span>Size</span>{smallInput(row, i, 'size', 'Size', '120×60')}</label>
                                </div>
                            </div>
                        ))}
                        {canEdit && values.rows.length < SHEET_ROWS && (
                            <button type="button" className="ss-add-card" onClick={addRow}>+ Add Another Item</button>
                        )}
                    </div>
                )}
            </section>

            <section className="fm-section">
                <FormField name="specialNotes" id="ss-notes" label="Special notes">
                    <textarea
                        id="ss-notes"
                        className="fm-input ss-notes"
                        rows={4}
                        value={values.specialNotes}
                        placeholder="Special requests, delivery notes or details…"
                        disabled={!canEdit}
                        onChange={(e) => { touch(); setValues((v) => ({ ...v, specialNotes: e.target.value })); }}
                    />
                </FormField>
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
                    savesFirst={canEdit && dirty > 0}
                    sending={sending}
                    error={emailError}
                    onSend={sendEmail}
                    onClose={() => setEmailOpen(false)}
                />
            )}
            {cropper && <TagCropper src={cropper.src} onScan={runScan} onClose={() => setCropper(null)} />}
        </FormModal>
    );
}
