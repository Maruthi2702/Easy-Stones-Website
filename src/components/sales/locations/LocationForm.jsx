import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker } from '../../shared/form/FormControls';
import { goToField, describedBy } from '../../shared/form/formFocus';
import useTouched from '../../shared/form/useTouched';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { formatPhoneInput } from '../../../utils/phoneUtils';
import { lastChangedText } from '../../../utils/userForm';
import {
    FIELD_LABELS, ADDRESS_FIELDS, PRICE_LEVELS, PAYMENT_TERMS, priceLevelLabel,
    emptyLocationValues, locationToFormValues, locationRecordFromValues,
    validateLocationValues, countLocationChanges
} from '../../../utils/locationForm';
import './LocationForm.css';

/*
 * Users & Roles → Locations → Add location / Edit (pencil). One form for
 * both, on the shared template (FORM_TEMPLATE.md), size L. Approved design:
 * the "Add Location Form" canvas (claude.ai/artifact/Bn51i5daUgCyttuncHfJMW).
 *
 * The rules — required fields, formats, unique short name/code, which
 * locations can be an RDC — are src/utils/locationForm.js, which the server
 * runs too. The short name is locked on edit: it's the key on users,
 * check-ins and reports, so renaming would orphan them.
 */

// Input clean-up as you type: the stored formats, so what's on screen is
// what gets saved.
const CLEAN = {
    shortCode: (v) => v.toUpperCase().replace(/\s/g, '').slice(0, 5),
    state: (v) => v.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2),
    acctState: (v) => v.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2),
    zip: (v) => v.replace(/[^\d-]/g, '').slice(0, 10),
    acctZip: (v) => v.replace(/[^\d-]/g, '').slice(0, 10),
    phone: formatPhoneInput,
    fax: formatPhoneInput,
    acctPhone: formatPhoneInput,
    salesTaxRate: (v) => v.replace(/[^\d.]/g, ''),
    avgUnitFreight: (v) => v.replace(/[^\d.]/g, ''),
    unitOverheadPct: (v) => v.replace(/[^\d.]/g, '')
};

export default function LocationForm({ location = null, locations = [], onClose, onSaved, onDelete }) {
    const isEdit = Boolean(location);
    const initial = useMemo(() => (isEdit ? locationToFormValues(location) : emptyLocationValues()), [isEdit, location]);
    const [values, setValues] = useState(initial);
    const [touched, touchField, markTouched] = useTouched();
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverErrors, setServerErrors] = useState({});
    const [formError, setFormError] = useState('');
    const [salesReps, setSalesReps] = useState([]);

    useEffect(() => {
        let alive = true;
        authFetch(`${API_URL}/api/salesreps`)
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => { if (alive) setSalesReps(data?.success ? data.data : (Array.isArray(data) ? data : [])); })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    const others = useMemo(
        () => (Array.isArray(locations) ? locations : []).filter((l) => l && typeof l === 'object' && (!isEdit || String(l._id) !== String(location._id))),
        [locations, isEdit, location]
    );
    const ruleOptions = { isEdit, selfId: location?._id, others };

    const set = (patch) => {
        setValues((v) => ({ ...v, ...patch }));
        setServerErrors((e) => {
            const next = { ...e };
            for (const k of Object.keys(patch)) delete next[k];
            return next;
        });
    };
    const touch = (field) => touchField(field, String(values[field] ?? '') !== String(initial[field] ?? ''));

    const allErrors = { ...validateLocationValues(values, ruleOptions), ...serverErrors };
    const shown = (field) => (allErrors[field] && (submitted || touched[field] || serverErrors[field]) ? allErrors[field] : '');
    const visibleErrors = Object.fromEntries(Object.keys(FIELD_LABELS).filter((k) => allErrors[k]).map((k) => [k, allErrors[k]]));

    const dirtyCount = countLocationChanges(values, initial);
    const addressChanged = ADDRESS_FIELDS.some((k) => String(values[k]).trim() !== String(initial[k]).trim());

    const rdcOptions = useMemo(() => [
        { value: '', label: 'None' },
        ...others
            .filter((l) => l.name !== values.name.trim())
            .map((l) => ({ value: l.name, label: l.fullName || l.name, description: l.fullName ? l.name : undefined }))
    ], [others, values.name]);
    const repOptions = useMemo(() => {
        // Deactivated staff stay off the list; one already saved here still shows.
        const names = [...new Set(salesReps.filter((r) => r?.isActive !== false).map((r) => String(r?.name || '').trim()).filter(Boolean))];
        if (values.salesRep && !names.includes(values.salesRep)) names.unshift(values.salesRep);
        return [{ value: '', label: 'None' }, ...names.map((n) => ({ value: n, label: n }))];
    }, [salesReps, values.salesRep]);
    const priceOptions = [{ value: '', label: 'None' }, ...PRICE_LEVELS.map((l) => ({ value: String(l), label: priceLevelLabel(l) }))];
    const termsOptions = [{ value: '', label: 'None' }, ...PAYMENT_TERMS.map((t) => ({ value: t, label: t }))];

    const submit = async () => {
        setSubmitted(true);
        setFormError('');
        const errors = validateLocationValues(values, ruleOptions);
        const first = Object.keys(FIELD_LABELS).find((k) => errors[k] || serverErrors[k]);
        if (first) {
            goToField(first);
            return;
        }
        setSaving(true);
        try {
            const res = await authFetch(isEdit ? `${API_URL}/api/admin/locations/${location._id}` : `${API_URL}/api/admin/locations`, {
                method: isEdit ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(locationRecordFromValues(values))
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data.field && FIELD_LABELS[data.field]) {
                    setServerErrors({ [data.field]: data.message });
                    setTimeout(() => goToField(data.field), 0);
                } else {
                    setFormError(data.message || 'Could not save this location. Try again.');
                }
                return;
            }
            onSaved?.(data);
            onClose();
        } catch {
            setFormError('Couldn’t reach the server. Check your connection and try again.');
        } finally {
            setSaving(false);
        }
    };

    // One text field: label, input, error. `name` is the FIELD_LABELS key.
    // index.css title-cases every text input; codes, addresses' state/ZIP,
    // websites and numbers must read exactly as typed.
    const text = (name, { label = FIELD_LABELS[name], required = false, type = 'text', placeholder, inputMode, prefix, suffix, readOnly = false, title, autoCapitalize, asTyped = false } = {}) => {
        const id = `loc-${name}`;
        const error = shown(name);
        const input = (
            <input
                id={id}
                className={`fm-input${asTyped ? ' no-capitalize' : ''}${prefix ? ' loc-has-prefix' : ''}${suffix ? ' loc-has-suffix' : ''}`}
                type={type}
                inputMode={inputMode}
                value={values[name]}
                placeholder={placeholder}
                readOnly={readOnly}
                title={title}
                autoComplete="off"
                autoCapitalize={autoCapitalize ?? (asTyped ? undefined : 'words')}
                spellCheck={type === 'email' || type === 'url' ? false : undefined}
                onChange={(e) => set({ [name]: CLEAN[name] ? CLEAN[name](e.target.value) : e.target.value })}
                onBlur={() => touch(name)}
                {...describedBy(id, error)}
            />
        );
        return (
            <FormField name={name} id={id} label={label} required={required} error={error}>
                {prefix || suffix ? (
                    <div className="loc-adorn">
                        {prefix && <span className="loc-adorn-prefix" aria-hidden="true">{prefix}</span>}
                        {input}
                        {suffix && <span className="loc-adorn-suffix" aria-hidden="true">{suffix}</span>}
                    </div>
                ) : input}
            </FormField>
        );
    };
    const picker = (name, options, placeholder) => {
        const id = `loc-${name}`;
        return (
            <FormField name={name} id={id} label={FIELD_LABELS[name]} error={shown(name)}>
                <FormPicker
                    id={id}
                    value={values[name]}
                    onChange={(v) => { set({ [name]: v }); markTouched(name); }}
                    options={options}
                    placeholder={placeholder}
                    sheetTitle={FIELD_LABELS[name]}
                    error={shown(name)}
                />
            </FormField>
        );
    };
    const checkbox = (name, label) => (
        <label className="loc-check">
            <input type="checkbox" checked={Boolean(values[name])} onChange={(e) => set({ [name]: e.target.checked })} />
            <span>{label}</span>
        </label>
    );
    // City / State / ZIP for either address block.
    const cityStateZip = (prefix = '') => {
        const k = (f) => (prefix ? `${prefix}${f[0].toUpperCase()}${f.slice(1)}` : f);
        const required = !prefix;
        return (
            <div className="loc-csz">
                {text(k('city'), { label: 'City', required })}
                {text(k('state'), { label: 'State', required, placeholder: 'NC', autoCapitalize: 'characters', asTyped: true })}
                {text(k('zip'), { label: 'ZIP code', required, inputMode: 'numeric', asTyped: true })}
            </div>
        );
    };

    const geoValue = !addressChanged && location?.coordinates?.lat != null && location?.coordinates?.lng != null
        ? `(${location.coordinates.lat}, ${location.coordinates.lng})`
        : '';

    const footerStart = isEdit && onDelete ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            disabled={saving || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Save or discard your changes first' : 'Delete this location'}
            onClick={async () => { if (await onDelete(location)) onClose(); }}
        >
            <Trash2 size={16} aria-hidden="true" />
            Delete location
        </button>
    ) : null;

    return (
        <FormModal
            title={isEdit ? <>Edit location <span className="fm-title-sub">· {location.name}</span></> : 'Add a location'}
            size="l"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={isEdit ? 'Save changes' : 'Add location'}
            savingLabel="Saving…"
            saving={saving}
            submitDisabled={isEdit && dirtyCount === 0}
            dirtyCount={dirtyCount}
            discardTitle={isEdit ? 'Discard your changes?' : 'Discard this location?'}
            errors={visibleErrors}
            showErrors={submitted}
            fieldLabels={FIELD_LABELS}
            footerStart={footerStart}
            footerNote={formError
                ? <span className="fm-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{formError}</span>
                : (isEdit ? lastChangedText(location) : null)}
        >
            <FormSection number={1} title="Which location is it?">
                <FormRow>
                    {text('fullName', { required: true, placeholder: 'Easy Stones - Portland' })}
                    {text('name', isEdit
                        ? { required: true, readOnly: true, title: 'The short name can’t be changed — users, check-ins and reports are linked to it' }
                        : { required: true, placeholder: 'Portland' })}
                    {text('shortCode', { placeholder: 'PDX', autoCapitalize: 'characters', asTyped: true })}
                    {text('region')}
                    {picker('rdc', rdcOptions, 'None')}
                </FormRow>
                <fieldset className="loc-checks">
                    <legend className="fm-label">This location is a</legend>
                    <div className="loc-checks-row">
                        {checkbox('profitCenter', 'Profit center')}
                        {checkbox('warehouse', 'Warehouse')}
                    </div>
                </fieldset>
            </FormSection>

            <FormSection number={2} title="Primary contact">
                <FormRow>
                    {text('contactName', { placeholder: 'Full name' })}
                    {text('email', { type: 'email', inputMode: 'email', placeholder: 'name@easystones.com', autoCapitalize: 'off' })}
                    {text('street', { required: true })}
                    {text('suite')}
                </FormRow>
                {cityStateZip()}
                <FormRow>
                    {text('phone', { type: 'tel', inputMode: 'tel', placeholder: '(555) 555-5555' })}
                    {text('fax', { type: 'tel', inputMode: 'tel', placeholder: '(555) 555-5555' })}
                    {text('website', { inputMode: 'url', placeholder: 'easystones.com', autoCapitalize: 'off', asTyped: true })}
                    <FormField name="coordinates" id="loc-geo" label="Map location (lat, long)">
                        <input
                            id="loc-geo"
                            className="fm-input no-capitalize"
                            type="text"
                            value={geoValue}
                            readOnly
                            tabIndex={-1}
                            placeholder={isEdit && addressChanged ? 'Updates from the new address when saved' : 'Found from the address when saved'}
                        />
                    </FormField>
                </FormRow>
            </FormSection>

            <FormSection number={3} title="Accounting contact">
                {checkbox('acctSameAsPrimary', 'Same as primary contact')}
                {!values.acctSameAsPrimary && (
                    <>
                        <FormRow>
                            {text('acctName', { label: 'Contact name', placeholder: 'Full name' })}
                            {text('acctEmail', { label: 'Email address', type: 'email', inputMode: 'email', placeholder: 'name@easystones.com', autoCapitalize: 'off' })}
                            {text('acctStreet', { label: 'Street address' })}
                            {text('acctSuite', { label: 'Suite / unit' })}
                        </FormRow>
                        {cityStateZip('acct')}
                        <FormRow>
                            {text('acctPhone', { label: 'Phone number', type: 'tel', inputMode: 'tel', placeholder: '(555) 555-5555' })}
                        </FormRow>
                    </>
                )}
            </FormSection>

            <FormSection number={4} title="Defaults for customer sales">
                <FormRow>
                    {picker('salesRep', repOptions, 'Choose a sales person')}
                    {picker('priceLevel', priceOptions, 'Choose a price level')}
                    {picker('paymentTerms', termsOptions, 'Choose payment terms')}
                </FormRow>
                <FormRow>
                    {text('salesTaxArea', { placeholder: 'NC - Mecklenburg' })}
                    {text('salesTaxRate', { inputMode: 'decimal', placeholder: '0.00', suffix: '%', asTyped: true })}
                </FormRow>
            </FormSection>

            <FormSection number={5} title="Cost overrides">
                <FormRow>
                    {text('avgUnitFreight', { inputMode: 'decimal', placeholder: '0.00', prefix: '$', asTyped: true })}
                    {text('unitOverheadPct', { inputMode: 'decimal', placeholder: '0.00', suffix: '%', asTyped: true })}
                </FormRow>
            </FormSection>
        </FormModal>
    );
}
