import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mail, AlertCircle } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, PasswordInput, SegmentedToggle } from '../../shared/form/FormControls';
import { goToField, describedBy } from '../../shared/form/formFocus';
import useTouched from '../../shared/form/useTouched';
import LocationsPicker from './LocationsPicker';
import CopyButton from './CopyButton';
import SignInHandover from './SignInHandover';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { locationNames } from '../../../utils/locationFilter';
import {
    suggestUsername, usernameProblem, generateTempPassword, validateNewUser,
    countChangedFields, FIELD_LABELS
} from '../../../utils/userForm';
import './AddUserForm.css';

/*
 * Users & Roles → Add user. Design A from the Add New User canvas, built on
 * the app-wide form template (FORM_TEMPLATE.md, shared/form/). The rules —
 * username suggestion, validation, temporary passwords — are in
 * src/utils/userForm.js with tests; the server re-checks them in
 * POST /api/admin/users and does the first-sign-in / invite part in
 * src/routes/userOnboarding.js.
 */

export default function AddUserForm({ roles, locations, describeRole, isDriverRole, onClose, onCreated }) {
    const branchNames = useMemo(() => locationNames(locations), [locations]);
    const initial = useMemo(() => {
        const firstBranch = branchNames[0] || 'Seattle';
        const defaultRole = roles.find((r) => r.name === 'sales_rep') || roles[0];
        return {
            displayName: '',
            email: '',
            username: '',
            joiningDate: '',
            role: defaultRole?.name || '',
            assignedLocations: [firstBranch],
            location: firstBranch,
            signInMethod: 'password',
            password: generateTempPassword()
        };
        // The starting point is fixed when the form opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [values, setValues] = useState(initial);
    const [usernameEdited, setUsernameEdited] = useState(false);
    const [touched, touchField, markTouched] = useTouched();
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverErrors, setServerErrors] = useState({});
    const [formError, setFormError] = useState('');
    const [availability, setAvailability] = useState({ state: 'idle' }); // idle | checking | available | taken | error
    const [created, setCreated] = useState(null);

    const set = (patch) => {
        setValues((v) => ({ ...v, ...patch }));
        setServerErrors((e) => {
            const next = { ...e };
            for (const k of Object.keys(patch)) delete next[k];
            return next;
        });
    };
    // On leaving a field: only if they typed in it (see useTouched).
    const touch = (name) => touchField(name, String(values[name] ?? '') !== String(initial[name] ?? ''));

    // Live "✓ Available": debounced, and only the latest answer counts.
    const checkSeq = useRef(0);
    useEffect(() => {
        const username = values.username.trim().toLowerCase();
        const seq = ++checkSeq.current;
        if (!username || usernameProblem(username)) {
            setAvailability({ state: 'idle' });
            return;
        }
        setAvailability({ state: 'checking' });
        const timer = setTimeout(async () => {
            try {
                const res = await authFetch(`${API_URL}/api/admin/users/username-available?username=${encodeURIComponent(username)}`);
                const data = await res.json().catch(() => ({}));
                if (seq !== checkSeq.current) return;
                if (!res.ok) setAvailability({ state: 'error' });
                else setAvailability(data.available ? { state: 'available' } : { state: 'taken', reason: data.reason });
            } catch {
                if (seq === checkSeq.current) setAvailability({ state: 'error' });
            }
        }, 350);
        return () => clearTimeout(timer);
    }, [values.username]);

    const allErrors = useMemo(() => ({
        ...validateNewUser(values, { usernameTaken: availability.state === 'taken' }),
        ...serverErrors
    }), [values, availability.state, serverErrors]);

    // Shown after they leave a field, or for everything once Create is pressed.
    // A taken username shows straight away — it's news, not a nag.
    const shown = (name) => {
        if (!allErrors[name]) return '';
        if (submitted || touched[name] || serverErrors[name]) return allErrors[name];
        if (name === 'username' && availability.state === 'taken') return allErrors[name];
        return '';
    };
    const visibleErrors = Object.fromEntries(Object.keys(FIELD_LABELS).filter((k) => allErrors[k]).map((k) => [k, allErrors[k]]));

    const roleOptions = useMemo(
        () => roles.map((r) => ({ value: r.name, label: r.displayName || r.name, description: describeRole(r) })),
        [roles, describeRole]
    );
    const selectedRole = roles.find((r) => r.name === values.role);
    const firstName = values.displayName.trim().split(/\s+/)[0];
    const homeForNote = values.location || (values.assignedLocations.includes('*') ? '' : values.assignedLocations[0]);
    const footerNote = selectedRole && isDriverRole(selectedRole) && firstName && homeForNote
        ? `${firstName} will get a truck column on ${homeForNote}’s delivery board.`
        : null;

    // The home branch moves with Locations — one field to the person filling it in.
    const withoutHome = ({ location: _home, ...rest }) => rest;
    const dirtyCount = created ? 0 : countChangedFields(withoutHome(values), withoutHome(initial));

    const submit = async () => {
        setSubmitted(true);
        setFormError('');
        const errors = validateNewUser(values, { usernameTaken: availability.state === 'taken' });
        const first = Object.keys(FIELD_LABELS).find((k) => errors[k] || serverErrors[k]);
        if (first) {
            goToField(first);
            return;
        }
        setSaving(true);
        try {
            const res = await authFetch(`${API_URL}/api/admin/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: values.displayName.trim(),
                    email: values.email.trim(),
                    username: values.username.trim().toLowerCase(),
                    joiningDate: values.joiningDate,
                    role: values.role,
                    assignedLocations: values.assignedLocations,
                    location: values.location,
                    signInMethod: values.signInMethod,
                    ...(values.signInMethod === 'password' ? { password: values.password } : {})
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data.field && FIELD_LABELS[data.field]) {
                    setServerErrors({ [data.field]: data.message });
                    setTimeout(() => goToField(data.field), 0);
                } else {
                    setFormError(data.message || 'Could not create this user. Try again.');
                }
                return;
            }
            setCreated({ ...data, password: values.signInMethod === 'password' ? values.password : '' });
            onCreated?.(data.user);
        } catch {
            setFormError('Couldn’t reach the server. Check your connection and try again.');
        } finally {
            setSaving(false);
        }
    };

    if (created) {
        return <SignInHandover method={values.signInMethod} result={created} password={created.password} onClose={onClose} />;
    }

    return (
        <FormModal
            title="Add a user"
            size="m"
            onClose={onClose}
            onSubmit={submit}
            submitLabel="Create user"
            savingLabel="Creating…"
            saving={saving}
            dirtyCount={dirtyCount}
            discardTitle="Discard this new user?"
            errors={visibleErrors}
            showErrors={submitted}
            fieldLabels={FIELD_LABELS}
            footerNote={formError ? <span className="fm-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{formError}</span> : footerNote}
        >
            <FormSection number={1} title="Who are they?">
                <FormRow>
                    <FormField name="displayName" id="au-name" label="Full name" required error={shown('displayName')}>
                        <input
                            id="au-name"
                            className="fm-input"
                            type="text"
                            autoCapitalize="words"
                            value={values.displayName}
                            autoComplete="off"
                            onChange={(e) => {
                                const displayName = e.target.value;
                                set(usernameEdited ? { displayName } : { displayName, username: suggestUsername(displayName) });
                            }}
                            onBlur={() => touch('displayName')}
                            {...describedBy('au-name', shown('displayName'))}
                        />
                    </FormField>
                    <FormField name="email" id="au-email" label="Work email" required error={shown('email')}>
                        <input
                            id="au-email"
                            className="fm-input"
                            type="email"
                            inputMode="email"
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            value={values.email}
                            onChange={(e) => set({ email: e.target.value })}
                            onBlur={() => touch('email')}
                            {...describedBy('au-email', shown('email'))}
                        />
                    </FormField>
                    <FormField
                        name="username"
                        id="au-username"
                        label="Username"
                        required
                        error={shown('username')}
                        status={availability.state === 'available' ? <><Check size={13} strokeWidth={2.6} aria-hidden="true" />Available</>
                            : availability.state === 'checking' ? 'Checking…'
                            : availability.state === 'error' ? 'Couldn’t check — it’ll be checked when you create'
                            : null}
                        statusTone={availability.state === 'available' ? 'ok' : undefined}
                    >
                        <input
                            id="au-username"
                            className="fm-input fm-input-mono no-capitalize"
                            type="text"
                            value={values.username}
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            onChange={(e) => {
                                setUsernameEdited(true);
                                set({ username: e.target.value.toLowerCase() });
                            }}
                            onBlur={() => touch('username')}
                            {...describedBy('au-username', shown('username'), availability.state !== 'idle')}
                        />
                    </FormField>
                    <FormField name="joiningDate" id="au-joining" label="Joining date" required error={shown('joiningDate')}>
                        <input
                            id="au-joining"
                            className="fm-input"
                            type="date"
                            value={values.joiningDate}
                            onChange={(e) => set({ joiningDate: e.target.value })}
                            onBlur={() => touch('joiningDate')}
                            {...describedBy('au-joining', shown('joiningDate'))}
                        />
                    </FormField>
                </FormRow>
            </FormSection>

            <FormSection number={2} title="What do they do?">
                <FormField name="role" id="au-role" label="Role" required error={shown('role')}>
                    <FormPicker
                        id="au-role"
                        value={values.role}
                        onChange={(role) => { set({ role }); markTouched('role'); }}
                        options={roleOptions}
                        placeholder="Choose a role"
                        sheetTitle="Role"
                        error={shown('role')}
                    />
                </FormField>
            </FormSection>

            <FormSection number={3} title="Where do they work?">
                <FormField name="assignedLocations" id="au-locations" label="Locations" required error={shown('assignedLocations')}>
                    <LocationsPicker
                        id="au-locations"
                        locations={branchNames}
                        value={values.assignedLocations}
                        home={values.location}
                        onChange={(patch) => { set(patch); markTouched('assignedLocations'); }}
                        error={shown('assignedLocations')}
                    />
                </FormField>
            </FormSection>

            <FormSection number={4} title="How will they sign in?">
                <SegmentedToggle
                    label="Sign-in method"
                    value={values.signInMethod}
                    onChange={(signInMethod) => set({ signInMethod })}
                    options={[{ value: 'password', label: 'Temporary password' }, { value: 'invite', label: 'Email an invite' }]}
                />
                {values.signInMethod === 'password' ? (
                    <FormField name="password" id="au-password" label="Temporary password" required error={shown('password')}>
                        <div className="fm-inline">
                            <PasswordInput
                                id="au-password"
                                value={values.password}
                                onChange={(e) => set({ password: e.target.value })}
                                onBlur={() => touch('password')}
                                error={shown('password')}
                            />
                            <CopyButton text={values.password} />
                        </div>
                    </FormField>
                ) : (
                    <div className="fm-note-box">
                        <Mail size={16} aria-hidden="true" style={{ flex: 'none' }} />
                        <span>Sends to <strong>{values.email.trim() || 'their work email'}</strong></span>
                    </div>
                )}
            </FormSection>
        </FormModal>
    );
}
