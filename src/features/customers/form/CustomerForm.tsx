import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Camera, Info, Plus, Trash2, Upload } from 'lucide-react';
import Tesseract from 'tesseract.js';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSheet } from '../../../components/shared/form/FormControls';
import type { FormOption } from '../../../components/shared/form/FormControls';
import { goToField, describedBy } from '../../../components/shared/form/formFocus';
import useTouched from '../../../components/shared/form/useTouched';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { formatPhoneInput } from '../../../utils/phoneUtils';
import { parseBusinessCard } from '../../../utils/cardParser';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { useStartingRep } from '../../../api/salesRepOptions';
import RepPicker from '../../../components/shared/form/RepPicker';
import type { RepOption } from '../../../components/shared/form/RepPicker';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import {
    STATUS_OPTIONS, LEVEL_OPTIONS, TYPE_OPTIONS, MODA_DISPLAY_OPTIONS, FIELD_LABELS, withCurrent,
    emptyCustomerValues, customerToFormValues, validateCustomerValues, withEmail, countCustomerChanges,
    applyCardScan, customerLastChangedText
} from '../../../utils/customerForm';
import type { CustomerFormValues, CustomerAddress, Option } from '../../../utils/customerForm';
import type { Loose } from '../../../types/records';
import './CustomerForm.css';

/*
 * Add customer / Edit customer, on the shared form template
 * (FORM_TEMPLATE.md), size M. Approved design: model A on the "Add & Edit
 * Customer" canvas (claude.ai/artifact/G6YUNXvbtVqScRGB7dHtXD) — groups with
 * dividers and no headings, every account setting a dropdown, the business
 * card behind the + next to the ✕, no Cancel.
 *
 * Mounted by AddCustomerModal (which keeps its old read-only view), so every
 * caller — Sales CRM, the Customers list, the route planner — gets it with
 * the same onSave(form, close) it already had. The rules are
 * src/utils/customerForm.ts.
 */

const ocr = (image: string, onProgress: (percent: number) => void): Promise<string> =>
    Tesseract.recognize(image, 'eng', {
        logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.floor(m.progress * 100)); }
    }).then((r) => r.data.text);

export type CustomerFormProps = {
    onClose: () => void;
    /** Called with the form's values and the close function, as every caller's save already was. */
    onSave: (values: CustomerFormValues, close: () => void) => void;
    isSaving?: boolean;
    editingCustomer?: Loose | null;
    salesReps?: Loose[];
    locations?: string[];
    currentUser?: Loose | null;
    onOpenExisting?: ((customer: Loose) => void) | null;
    /** Resolves true when the customer was deleted (the form then closes). */
    onDelete?: ((customer: Loose) => Promise<boolean> | boolean) | null;
    prefill?: (Partial<Omit<CustomerFormValues, 'address'>> & { address?: Partial<CustomerAddress> }) | null;
};

/** One text field's options (see `text` below). */
type TextOptions = {
    required?: boolean; type?: string; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
    autoComplete?: string; asTyped?: boolean; onBlur?: () => void; status?: string | null; error?: string; value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function CustomerForm({
    onClose, onSave, isSaving = false, editingCustomer = null,
    salesReps = [], locations = [], currentUser = null, onOpenExisting = null, onDelete = null, prefill = null
}: CustomerFormProps) {
    const isEdit = Boolean(editingCustomer);
    const isPhone = useIsPhone();
    // Who a new customer starts with: you if you're a sales rep, else the
    // branch's sales person (src/api/salesRepOptions.js → useStartingRep).
    const { repFor, ready: repsReady } = useStartingRep(currentUser);
    const defaults = emptyCustomerValues({ salesReps: salesReps as { _id: string; inactive?: boolean }[], locations, currentUser, repFor: repsReady ? repFor : null });
    const [initial, setInitial] = useState<CustomerFormValues>(() => (isEdit ? customerToFormValues(editingCustomer!) : defaults));
    // A new customer may open filled in (Permits → a contractor's "Create customer"):
    // those values count as changes, so closing asks before throwing them away.
    const [values, setValues] = useState<CustomerFormValues>(() => (!isEdit && prefill
        ? { ...initial, ...prefill, address: { ...initial.address, ...(prefill.address || {}) } }
        : initial));
    const [touched, touchField] = useTouched();
    const [submitted, setSubmitted] = useState(false);

    // The rep and branch lists are fetched by the caller and can arrive after
    // the form opens. Fill those two defaults in when they do — only where
    // still blank — and move the starting point with them, so an untouched
    // form doesn't count them as changes.
    if (!isEdit && ((defaults.salesRep && !initial.salesRep) || (defaults.location && !initial.location))) {
        const patch = { salesRep: initial.salesRep || defaults.salesRep, location: initial.location || defaults.location };
        setInitial({ ...initial, ...patch });
        setValues((v) => ({ ...v, salesRep: v.salesRep || patch.salesRep, location: v.location || patch.location }));
    }

    const set = (patch: Partial<CustomerFormValues>) => setValues((v) => ({ ...v, ...patch }));
    // A new customer moved to another branch takes that branch's starting rep
    // — unless someone already picked a different rep by hand.
    const offeredRep = (id: string) => Boolean(id) && salesReps.some((r) => String(r._id) === String(id) && !r.inactive);
    const setLocation = (location: string) => setValues((v) => {
        if (isEdit || !repsReady) return { ...v, location };
        const before = String(repFor(v.location)?._id || '');
        const after = String(repFor(location)?._id || '');
        const followsBranch = String(v.salesRep || '') === before;
        // Still the old branch's starting rep → the new branch's (Unassigned if it has none).
        return { ...v, location, ...(followsBranch ? { salesRep: offeredRep(after) ? after : '' } : {}) };
    });
    const setAddress = (patch: Partial<CustomerAddress>) => setValues((v) => ({ ...v, address: { ...v.address, ...patch } }));

    const errors: Record<string, string | undefined> = validateCustomerValues(values);
    const shown = (f: string) => (errors[f] && (submitted || touched[f]) ? errors[f] : '');
    const visibleErrors = Object.fromEntries(Object.keys(FIELD_LABELS).filter((k) => errors[k]).map((k) => [k, errors[k]]));
    const dirtyCount = countCustomerChanges(values, initial);

    // ── Possible duplicates (new customers only; advice, never blocks saving) ──
    // Same rules as the import and the duplicate audit (customerMatch.js, via
    // POST /api/customers/possible-duplicates).
    const [dupMatches, setDupMatches] = useState<{ customer: Loose; signals: string[] }[]>([]);
    const [dupDismissed, setDupDismissed] = useState(false);
    const dupSeq = useRef(0);
    useEffect(() => {
        if (isEdit) return undefined;
        const company = values.company.trim();
        const phone = values.phone.trim();
        const email = values.email.trim();
        const seq = ++dupSeq.current;
        const timer = setTimeout(async () => {
            if (!company && !phone && !email) { setDupMatches([]); return; }
            try {
                const res = await authFetch(`${API_URL}/api/customers/possible-duplicates`, {
                    method: 'POST',
                    body: JSON.stringify({ company, phone, email })
                });
                if (seq !== dupSeq.current || !res.ok) return;
                const data = await res.json();
                if (seq === dupSeq.current) setDupMatches(data.matches || []);
            } catch {
                // Advice only; a failed check just shows nothing.
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [isEdit, values.company, values.phone, values.email]);

    // ── ZIP → city/state: only into blank fields; the last ZIP typed wins ──
    // Looked up when the ZIP field is left; a newer ZIP cancels an older lookup.
    const [zipNote, setZipNote] = useState('');
    const [zipQuery, setZipQuery] = useState('');
    useEffect(() => {
        if (!/^\d{5}$/.test(zipQuery)) return undefined;
        let live = true;
        const zip = zipQuery;
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/geocode/zip/${zip}`);
                if (!live) return;
                if (!res.ok) {
                    setZipNote(res.status === 404 ? `No city found for ${zip} — enter it yourself` : 'Couldn’t look up the ZIP — enter the city and state yourself');
                    return;
                }
                const { city, state } = await res.json();
                if (!live) return;
                setValues((v) => (v.address.zipCode.trim() !== zip ? v : {
                    ...v,
                    address: {
                        ...v.address,
                        city: v.address.city.trim() ? v.address.city : (city || v.address.city),
                        state: v.address.state.trim() ? v.address.state : (state || v.address.state)
                    }
                }));
            } catch {
                if (live) setZipNote('Couldn’t look up the ZIP — enter the city and state yourself');
            }
        })();
        return () => { live = false; };
    }, [zipQuery]);

    // ── Business card: the + next to the ✕ ──
    const [menuOpen, setMenuOpen] = useState(false);
    const [scan, setScan] = useState({ status: 'idle', progress: 0, result: '' }); // idle | camera | reading
    const plusRef = useRef<HTMLDivElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!menuOpen || isPhone) return undefined;
        const onDown = (e: MouseEvent) => { if (!plusRef.current?.contains(e.target as Node)) setMenuOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [menuOpen, isPhone]);

    // Bumped by every stop, so a camera that finishes starting after the form
    // closed (or Stop camera was pressed) is switched off instead of kept.
    const cameraRun = useRef(0);
    const stopCamera = () => {
        cameraRun.current += 1;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    };
    useEffect(() => stopCamera, []);

    const readCard = async (image: string) => {
        setScan({ status: 'reading', progress: 0, result: '' });
        try {
            const text = await ocr(image, (p) => setScan((s) => ({ ...s, progress: p })));
            const parsed = parseBusinessCard(text);
            // Whether anything was found depends only on the card; the values
            // are merged in the updater so typing during the read isn't lost.
            const { found } = applyCardScan(initial, parsed as Loose | null);
            if (found) setValues((v) => applyCardScan(v, parsed as Loose | null).values);
            setScan({ status: 'idle', progress: 0, result: found ? 'filled' : 'nothing' });
        } catch (err) {
            console.error('Card scan failed:', err);
            setScan({ status: 'idle', progress: 0, result: 'failed' });
        }
    };

    const startCamera = async () => {
        setMenuOpen(false);
        setScan({ status: 'camera', progress: 0, result: '' });
        const run = ++cameraRun.current;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            // Closed (or stopped) while the permission prompt was up.
            if (run !== cameraRun.current) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) {
            console.error('Camera error:', err);
            setScan({ status: 'idle', progress: 0, result: 'nocamera' });
        }
    };
    const capture = () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg');
        stopCamera();
        readCard(image);
    };
    const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => readCard(ev.target!.result as string);
        reader.readAsDataURL(file);
    };
    const pickPhoto = () => { setMenuOpen(false); fileRef.current?.click(); };

    const scanNote = ({
        filled: { tone: 'ok', text: 'Filled in from the card — check the details' },
        nothing: { tone: 'err', text: 'Couldn’t find contact details on that card. Try again with the card filling the frame.' },
        failed: { tone: 'err', text: 'Couldn’t read the card. Try again.' },
        nocamera: { tone: 'err', text: 'Couldn’t open the camera. Allow camera access, or upload a photo instead.' }
    } as Record<string, { tone: string; text: string }>)[scan.result];

    const cardItems = (
        <>
            <button type="button" role="menuitem" className="fm-opt" onClick={startCamera}>
                <Camera size={18} aria-hidden="true" /><span className="fm-opt-label">Scan card</span>
            </button>
            <button type="button" role="menuitem" className="fm-opt" onClick={pickPhoto}>
                <Upload size={18} aria-hidden="true" /><span className="fm-opt-label">Upload card photo</span>
            </button>
        </>
    );

    const headerActions = (
        <div
            className="cf-plus"
            ref={plusRef}
            onKeyDown={(e) => { if (e.key === 'Escape' && menuOpen) { e.stopPropagation(); setMenuOpen(false); } }}
        >
            <button
                type="button"
                className="cf-plus-btn"
                aria-label="Fill in from a business card"
                title="Fill in from a business card"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={isSaving || scan.status !== 'idle'}
                onClick={() => setMenuOpen((o) => !o)}
            >
                <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {menuOpen && !isPhone && <div className="fm-menu cf-plus-menu" role="menu">{cardItems}</div>}
        </div>
    );

    // ── Save ──
    const submit = () => {
        setSubmitted(true);
        const first = Object.keys(FIELD_LABELS).find((k) => errors[k]);
        if (first) {
            goToField(first);
            return;
        }
        onSave(values, onClose);
    };

    // Grouped under each rep's branch by RepPicker (the format every rep
    // dropdown shares). The customer rep list (toSalesRepList) keeps
    // deactivated reps so the Customer List can still filter by them; nobody
    // picks one for an account, though — only the rep already on this
    // customer still shows, and one no longer on the list shows under "Other".
    const repOptions = (() => {
        const list: RepOption[] = salesReps
            .filter((r) => !r.inactive || String(r._id) === String(values.salesRep))
            .map((r) => ({ value: String(r._id), label: r.name, location: r.location || '', id: String(r._id) }));
        if (values.salesRep && !list.some((o) => o.value === String(values.salesRep))) {
            list.push({ value: String(values.salesRep), label: editingCustomer?.salesRepName || 'Rep no longer listed', location: '' });
        }
        return list;
    })();

    const text = (name: string, label: string, { required = false, type = 'text', placeholder, inputMode, autoComplete = 'off', asTyped = false, onBlur, status, error, value, onChange }: TextOptions = {}) => {
        const id = `cf-${name}`;
        return (
            <FormField name={name} id={id} label={label} required={required} error={error} status={status}>
                <input
                    id={id}
                    className={`fm-input${asTyped ? ' no-capitalize' : ''}`}
                    type={type}
                    inputMode={inputMode}
                    value={value ?? (values as Loose)[name] ?? ''}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    // Names and addresses: the keyboard capitalizes each word
                    // as typed (the form shows and saves exactly what's typed).
                    autoCapitalize={asTyped ? undefined : 'words'}
                    onChange={onChange || ((e) => set({ [name]: e.target.value }))}
                    onBlur={onBlur}
                    {...describedBy(id, error, status)}
                />
            </FormField>
        );
    };
    const picker = (name: keyof CustomerFormValues, label: string, options: readonly Option[], onChange = (v: string) => set({ [name]: v })) => (
        <FormField name={name} id={`cf-${name}`} label={label}>
            <FormPicker id={`cf-${name}`} value={values[name] as string} onChange={onChange} options={options as FormOption[]} sheetTitle={label} />
        </FormField>
    );

    const footerStart = isEdit && onDelete ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            disabled={isSaving || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Save or discard your changes first' : 'Delete this customer'}
            onClick={async () => { if (await onDelete(editingCustomer!)) onClose(); }}
        >
            <Trash2 size={16} aria-hidden="true" />
            Delete customer
        </button>
    ) : null;

    const dupName = (m: Loose) => m.company || m.contactName || m.name;
    const dupMeta = (m: Loose) => [m.address?.city || m.city, m.phone, m.salesRepName || 'Unassigned', m.location || 'Seattle', m.status].filter(Boolean).join(' · ');

    return (
        <FormModal
            title={isEdit ? <>Edit customer <span className="fm-title-sub">· {editingCustomer!.company || editingCustomer!.contactName || 'Customer'}</span></> : 'Add a customer'}
            size="m"
            onClose={() => { stopCamera(); onClose(); }}
            onSubmit={submit}
            submitLabel={isEdit ? 'Save changes' : 'Add customer'}
            savingLabel="Saving…"
            saving={isSaving}
            submitDisabled={isEdit && dirtyCount === 0}
            dirtyCount={dirtyCount}
            discardTitle={isEdit ? 'Discard your changes?' : 'Discard this customer?'}
            errors={visibleErrors}
            showErrors={submitted}
            fieldLabels={FIELD_LABELS}
            footerStart={footerStart}
            footerNote={isEdit ? customerLastChangedText(editingCustomer!) : null}
            headerActions={headerActions}
        >
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
            {isPhone && (
                <FormSheet open={menuOpen} title="Business card" onClose={() => setMenuOpen(false)}>
                    <div role="menu" aria-label="Business card">{cardItems}</div>
                </FormSheet>
            )}

            {scan.status === 'camera' && (
                <div className="cf-scan" role="region" aria-label="Scan a business card">
                    <div className="cf-scan-frame">
                        <video
                            ref={(el) => { videoRef.current = el; if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current; }}
                            autoPlay
                            playsInline
                            muted
                            className="cf-scan-video"
                        />
                        <div className="cf-scan-guide" aria-hidden="true" />
                    </div>
                    <div className="cf-scan-actions">
                        <button type="button" className="fm-btn" onClick={() => { stopCamera(); setScan({ status: 'idle', progress: 0, result: '' }); }}>Stop camera</button>
                        <button type="button" className="fm-btn fm-btn-primary" onClick={capture}><Camera size={16} aria-hidden="true" />Capture</button>
                    </div>
                </div>
            )}
            {scan.status === 'reading' && (
                <div className="cf-scan cf-scan-reading" role="status">
                    <span className="cf-scan-reading-text"><span className="fm-spinner" aria-hidden="true" />Reading the card… {scan.progress}%</span>
                    <span className="cf-progress"><span style={{ width: `${scan.progress}%` }} /></span>
                </div>
            )}
            {scanNote && scan.status === 'idle' && (
                <div className={`cf-scan-note${scanNote.tone === 'err' ? ' cf-scan-note-err' : ''}`} role="status">{scanNote.text}</div>
            )}

            <FormSection>
                {text('company', 'Company name', { required: true, error: shown('company'), onBlur: () => touchField('company', values.company !== initial.company) })}
                {!isEdit && !dupDismissed && dupMatches.length > 0 && (
                    <div className="cf-dup" role="status">
                        <Info size={16} aria-hidden="true" />
                        <div className="cf-dup-body">
                            <strong>This may be a customer you already have</strong>
                            {dupMatches.map(({ customer: m, signals }) => (
                                <div className="cf-dup-row" key={m._id}>
                                    <div className="cf-dup-text">
                                        <b>{dupName(m)}</b>
                                        <span>{dupMeta(m)}</span>
                                        <span>Matches on: {signals.join(', ')}</span>
                                    </div>
                                    {onOpenExisting && (
                                        <button type="button" className="fm-btn fm-btn-small" onClick={() => { onClose(); onOpenExisting(m); }}>Open it</button>
                                    )}
                                </div>
                            ))}
                            <button type="button" className="cf-link" onClick={() => setDupDismissed(true)}>It’s a different business</button>
                        </div>
                    </div>
                )}
                <FormRow>
                    {text('customerName', 'Contact name')}
                    {text('phone', 'Phone', { type: 'tel', inputMode: 'tel', placeholder: '(555) 000-0000', asTyped: true, onChange: (e) => set({ phone: formatPhoneInput(e.target.value) }) })}
                </FormRow>
                <FormRow>
                    {text('email', 'Email', {
                        required: true, type: 'email', asTyped: true, error: shown('email'),
                        onChange: (e) => setValues((v) => withEmail(v, e.target.value)),
                        onBlur: () => touchField('email', values.email !== initial.email)
                    })}
                    {text('marketingEmail', 'Marketing email', { type: 'email', asTyped: true, placeholder: 'Same as email' })}
                </FormRow>
                <label className="cf-check">
                    <input type="checkbox" checked={Boolean(values.receiveMarketing)} onChange={(e) => set({ receiveMarketing: e.target.checked })} />
                    <span>Send marketing emails</span>
                </label>
            </FormSection>

            <FormSection>
                {text('street', 'Street address', { value: values.address.street, onChange: (e) => setAddress({ street: e.target.value }) })}
                <div className="cf-csz">
                    {text('city', 'City', { value: values.address.city, onChange: (e) => setAddress({ city: e.target.value }) })}
                    {text('state', 'State', { value: values.address.state, placeholder: 'WA', asTyped: true, onChange: (e) => setAddress({ state: e.target.value }) })}
                    {text('zipCode', 'ZIP code', {
                        value: values.address.zipCode, inputMode: 'numeric', asTyped: true, status: zipNote || null,
                        onChange: (e) => { setZipNote(''); setAddress({ zipCode: e.target.value }); },
                        onBlur: () => setZipQuery(values.address.zipCode.trim())
                    })}
                </div>
            </FormSection>

            <FormSection>
                <FormRow>
                    {picker('status', 'Status', withCurrent(STATUS_OPTIONS, values.status))}
                    {picker('level', 'Level', withCurrent(LEVEL_OPTIONS, values.level))}
                </FormRow>
                <FormRow>
                    {picker('customerType', 'Customer type', withCurrent(TYPE_OPTIONS, values.customerType))}
                    <FormField name="salesRep" id="cf-salesRep" label="Sales rep">
                        <RepPicker id="cf-salesRep" value={values.salesRep ? String(values.salesRep) : ''} onChange={(v) => set({ salesRep: v })} options={repOptions} noneLabel="Unassigned" you={currentUser?.id || currentUser?._id} />
                    </FormField>
                </FormRow>
                <FormRow>
                    <FormField name="location" id="cf-location" label="Location">
                        <LocationPicker id="cf-location" value={values.location || ''} onChange={setLocation} options={locations} user={currentUser} />
                    </FormField>
                    {picker('modaDisplay', 'Moda display', withCurrent(MODA_DISPLAY_OPTIONS, values.modaDisplay))}
                </FormRow>
                <FormRow>
                    {text('modaBinder', 'Moda binders', { placeholder: '0', inputMode: 'numeric', asTyped: true })}
                </FormRow>
            </FormSection>

            <FormSection>
                <FormField name="notes" id="cf-notes" label="Notes">
                    <textarea
                        id="cf-notes"
                        className="fm-input"
                        rows={4}
                        value={values.notes}
                        placeholder="Hours, access, preferences"
                        autoCapitalize="sentences"
                        onChange={(e) => set({ notes: e.target.value })}
                    />
                </FormField>
            </FormSection>
        </FormModal>
    );
}
