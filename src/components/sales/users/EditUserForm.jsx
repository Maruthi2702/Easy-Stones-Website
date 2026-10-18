import React, { useMemo, useState } from 'react';
import { Mail, AlertCircle, UserX, UserCheck, Lock, LockOpen } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, PasswordInput, SegmentedToggle } from '../../shared/form/FormControls';
import { goToField, describedBy } from '../../shared/form/formFocus';
import useTouched from '../../shared/form/useTouched';
import LocationsPicker from './LocationsPicker';
import CopyButton from './CopyButton';
import SignInHandover from './SignInHandover';
import { withDriverHandover } from './userAccess';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { locationNames } from '../../../utils/locationFilter';
import { prettifyUsername } from '../../../utils/textUtils';
import {
    generateTempPassword, validateUserEdit, userEditFields, userToFormValues, lastChangedText,
    countChangedFields, FIELD_LABELS, lockedUntilTime
} from '../../../utils/userForm';
import './AddUserForm.css';
import { DatePicker } from '../../shared/calendar/Calendar';

/*
 * Users & Roles (and /admin) → Edit user. The same form as Add user in the
 * template's edit mode (FORM_TEMPLATE.md): title names the person, Save
 * changes stays greyed out until something changes, Deactivate/Reactivate
 * sits at the far left of the footer and "Last changed by …" in the middle.
 *
 * The username is shown but can't be changed here: a driver's truck column
 * and their orders are keyed by it (truckId drv_<username>), so renaming one
 * would strand their deliveries.
 *
 * Sign-in: keep the current password, set a temporary one they must replace
 * at next sign-in, or email a link to choose a new one (PUT signInReset).
 * An account locked by too many wrong passwords shows when it lifts and an
 * "Unlock now" button (POST …/unlock) — saved straight away, not with the
 * form. Saving a reset unlocks it too.
 */

const SIGN_IN_OPTIONS = [
    { value: 'keep', label: 'Keep current' },
    { value: 'password', label: 'Temporary password' },
    { value: 'invite', label: 'Email a link' }
];

// `access` (from the Users & Roles actions the signed-in person holds,
// src/utils/usersAccess.js): edit = change details, role and locations;
// resetSignIn = temporary password / invite link; unlock; deactivate. Without
// edit the form is read-only. The server checks each again.
const FULL_ACCESS_TO_USER = { edit: true, resetSignIn: true, unlock: true, deactivate: true };

export default function EditUserForm({ user, roles, locations, describeRole, onClose, onSaved, onChangeAccess, access = FULL_ACCESS_TO_USER }) {
    const branchNames = useMemo(() => locationNames(locations), [locations]);
    const initial = useMemo(() => userToFormValues(user), [user]);
    const [values, setValues] = useState(initial);
    const [touched, touchField, markTouched] = useTouched();
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverErrors, setServerErrors] = useState({});
    const [formError, setFormError] = useState('');
    const [handover, setHandover] = useState(null);
    // 'idle' | 'busy' | 'done' — Unlock now, which saves on its own.
    const [unlockState, setUnlockState] = useState('idle');
    const lockTime = useMemo(() => lockedUntilTime(user), [user]);

    const name = String(user.displayName || '').trim() || prettifyUsername(user.username);

    const set = (patch) => {
        setValues((v) => ({ ...v, ...patch }));
        setServerErrors((e) => {
            const next = { ...e };
            for (const k of Object.keys(patch)) delete next[k];
            return next;
        });
    };
    const touch = (field) => touchField(field, String(values[field] ?? '') !== String(initial[field] ?? ''));

    const allErrors = useMemo(() => ({ ...validateUserEdit(values, initial), ...serverErrors }), [values, initial, serverErrors]);
    const shown = (field) => (allErrors[field] && (submitted || touched[field] || serverErrors[field]) ? allErrors[field] : '');
    const visibleErrors = Object.fromEntries(Object.keys(FIELD_LABELS).filter((k) => allErrors[k]).map((k) => [k, allErrors[k]]));

    const roleOptions = useMemo(() => {
        const list = roles.map((r) => ({ value: r.name, label: r.displayName || r.name, description: describeRole(r) }));
        // An account whose role was since deleted still shows what it has.
        if (initial.role && !list.some((o) => o.value === initial.role)) {
            list.push({ value: initial.role, label: initial.role, description: 'This role no longer exists — pick another' });
        }
        return list;
    }, [roles, describeRole, initial.role]);

    // What counts as a change. The temporary password is pre-generated when
    // that option is picked, so it's the choice of reset that counts, not the
    // text in the box; the home branch moves with Locations.
    const comparable = (v) => ({ ...v, location: undefined, password: undefined });
    const dirtyCount = handover ? 0 : countChangedFields(comparable(values), comparable(initial));
    const homeChanged = values.location !== initial.location;
    const changed = dirtyCount > 0 || homeChanged;

    const chooseSignIn = (signInMethod) => {
        set({ signInMethod, password: signInMethod === 'password' && !values.password ? generateTempPassword() : values.password });
    };

    const submit = async () => {
        setSubmitted(true);
        setFormError('');
        const errors = validateUserEdit(values, initial);
        const first = Object.keys(FIELD_LABELS).find((k) => errors[k] || serverErrors[k]);
        if (first) {
            goToField(first);
            return;
        }
        setSaving(true);
        try {
            const send = (moveUpcomingToPending) => authFetch(`${API_URL}/api/admin/users/${user._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // Unchanged fields stay out, so an older account's blank ones aren't sent.
                    ...userEditFields(values, initial),
                    ...(values.signInMethod === 'password' ? { signInReset: 'password', password: values.password } : {}),
                    ...(values.signInMethod === 'invite' ? { signInReset: 'invite' } : {}),
                    moveUpcomingToPending
                })
            });
            const res = await withDriverHandover(send, 'change the role');
            if (!res) return; // they chose not to move the orders — nothing saved
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data.field && FIELD_LABELS[data.field]) {
                    setServerErrors({ [data.field]: data.message });
                    setTimeout(() => goToField(data.field), 0);
                } else {
                    setFormError(data.message || 'Could not save these changes. Try again.');
                }
                return;
            }
            onSaved?.(data.user);
            if (values.signInMethod === 'keep') onClose();
            else setHandover({ method: values.signInMethod, result: data, password: values.password });
        } catch {
            setFormError('Couldn’t reach the server. Check your connection and try again.');
        } finally {
            setSaving(false);
        }
    };

    const unlock = async () => {
        setUnlockState('busy');
        setFormError('');
        try {
            const res = await authFetch(`${API_URL}/api/admin/users/${user._id}/unlock`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setUnlockState('idle');
                setFormError(data.message || 'Could not unlock this account. Try again.');
                return;
            }
            setUnlockState('done');
            onSaved?.(data.user);
        } catch {
            setUnlockState('idle');
            setFormError('Couldn’t reach the server. Check your connection and try again.');
        }
    };

    if (handover) {
        return <SignInHandover reset method={handover.method} result={handover.result} password={handover.password} onClose={onClose} />;
    }

    const inactive = user.isActive === false;
    const footerStart = onChangeAccess && access.deactivate ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            style={inactive ? { color: 'var(--fm-ok)' } : undefined}
            disabled={saving || changed}
            title={changed ? 'Save or discard your changes first' : inactive ? 'Let this person sign in again' : 'Stop this person signing in, keep their history'}
            onClick={async () => {
                if (await onChangeAccess(user, inactive ? 'reactivate' : 'deactivate')) onClose();
            }}
        >
            {inactive ? <UserCheck size={16} aria-hidden="true" /> : <UserX size={16} aria-hidden="true" />}
            {inactive ? 'Reactivate' : 'Deactivate'}
        </button>
    ) : null;

    return (
        <FormModal
            title={<>Edit user <span className="fm-title-sub">· {name}</span></>}
            size="m"
            onClose={onClose}
            onSubmit={submit}
            submitLabel="Save changes"
            savingLabel="Saving…"
            saving={saving}
            submitDisabled={!changed || !access.edit}
            dirtyCount={dirtyCount || (homeChanged ? 1 : 0)}
            discardTitle="Discard your changes?"
            errors={visibleErrors}
            showErrors={submitted}
            fieldLabels={FIELD_LABELS}
            footerStart={footerStart}
            footerNote={formError
                ? <span className="fm-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{formError}</span>
                : (access.edit ? lastChangedText(user) : 'View only — you can’t change this person.')}
        >
          <fieldset disabled={!access.edit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <FormSection number={1} title="Who are they?">
                <FormRow>
                    <FormField name="displayName" id="eu-name" label="Full name" required error={shown('displayName')}>
                        <input
                            id="eu-name"
                            className="fm-input"
                            type="text"
                            autoCapitalize="words"
                            value={values.displayName}
                            placeholder={prettifyUsername(user.username)}
                            autoComplete="off"
                            onChange={(e) => set({ displayName: e.target.value })}
                            onBlur={() => touch('displayName')}
                            {...describedBy('eu-name', shown('displayName'))}
                        />
                    </FormField>
                    <FormField name="email" id="eu-email" label="Work email" required error={shown('email')}>
                        <input
                            id="eu-email"
                            className="fm-input"
                            type="email"
                            inputMode="email"
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            value={values.email}
                            onChange={(e) => set({ email: e.target.value })}
                            onBlur={() => touch('email')}
                            {...describedBy('eu-email', shown('email'))}
                        />
                    </FormField>
                    <FormField name="username" id="eu-username" label="Username">
                        <input
                            id="eu-username"
                            className="fm-input fm-input-mono no-capitalize"
                            type="text"
                            value={values.username}
                            readOnly
                            title="Usernames can’t be changed — a driver’s deliveries are linked to theirs"
                        />
                    </FormField>
                    <FormField name="joiningDate" id="eu-joining" label="Joining date" required error={shown('joiningDate')}>
                        <DatePicker
                            id="eu-joining"
                            value={values.joiningDate}
                            onChange={(joiningDate) => set({ joiningDate })}
                            onBlur={() => touch('joiningDate')}
                            error={shown('joiningDate')}
                            sheetTitle="Joining date"
                        />
                    </FormField>
                </FormRow>
            </FormSection>

            <FormSection number={2} title="What do they do?">
                <FormField name="role" id="eu-role" label="Role" required error={shown('role')}>
                    <FormPicker
                        id="eu-role"
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
                <FormField name="assignedLocations" id="eu-locations" label="Locations" required error={shown('assignedLocations')}>
                    <LocationsPicker
                        id="eu-locations"
                        locations={branchNames}
                        value={values.assignedLocations}
                        home={values.location}
                        onChange={(patch) => { set(patch); markTouched('assignedLocations'); }}
                        error={shown('assignedLocations')}
                    />
                </FormField>
            </FormSection>

            <FormSection number={4} title="Sign-in">
                {lockTime && unlockState !== 'done' && (
                    <div className="fm-note-box" role="status" style={{ flexWrap: 'wrap', borderColor: 'var(--fm-err-bd)' }}>
                        <Lock size={16} aria-hidden="true" style={{ flex: 'none', color: 'var(--fm-err-bd)' }} />
                        <span style={{ flex: '1 1 200px' }}>Locked after too many wrong passwords — unlocks by itself at {lockTime}.</span>
                        {access.unlock && (
                            <button type="button" className="fm-btn fm-btn-small" onClick={unlock} disabled={unlockState === 'busy'} aria-busy={unlockState === 'busy'}>
                                <LockOpen size={14} aria-hidden="true" />
                                {unlockState === 'busy' ? 'Unlocking…' : 'Unlock now'}
                            </button>
                        )}
                    </div>
                )}
                {unlockState === 'done' && (
                    <div className="fm-note-box" role="status">
                        <LockOpen size={16} aria-hidden="true" style={{ flex: 'none', color: 'var(--fm-ok)' }} />
                        <span>Unlocked — they can sign in now.</span>
                    </div>
                )}
                {access.resetSignIn && <SegmentedToggle label="Sign-in" value={values.signInMethod} onChange={chooseSignIn} options={SIGN_IN_OPTIONS} />}
                {access.resetSignIn && values.signInMethod === 'password' && (
                    <FormField name="password" id="eu-password" label="Temporary password" required error={shown('password')}>
                        <div className="fm-inline">
                            <PasswordInput
                                id="eu-password"
                                value={values.password}
                                onChange={(e) => set({ password: e.target.value })}
                                onBlur={() => touch('password')}
                                error={shown('password')}
                            />
                            <CopyButton text={values.password} />
                        </div>
                    </FormField>
                )}
                {access.resetSignIn && values.signInMethod === 'invite' && (
                    <div className="fm-note-box">
                        <Mail size={16} aria-hidden="true" style={{ flex: 'none' }} />
                        <span>Sends a link to <strong>{values.email.trim() || 'their work email'}</strong></span>
                    </div>
                )}
            </FormSection>
          </fieldset>
        </FormModal>
    );
}
