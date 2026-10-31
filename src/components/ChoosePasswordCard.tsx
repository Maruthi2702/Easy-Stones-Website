import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { PASSWORD_MIN } from '../utils/userForm';
import '../pages/LoginPage.css';

/**
 * "Choose your password" — the one form both ways into a new staff account
 * use: an emailed invite link (SetPasswordPage) and a temporary password's
 * first sign-in (ChoosePasswordPage). Same rules as the server
 * (src/routes/userOnboarding.ts): at least PASSWORD_MIN characters, typed twice.
 *
 *   title, lead     the heading and the line under it
 *   username        for the browser's password manager (hidden field)
 *   onSave(pw)      resolves to an error message, or nothing when it worked
 *   notice          optional line above the button (e.g. who's signed in now)
 *   footer          optional, under the button (e.g. Sign out)
 *   className       extra class on the page container
 */
export default function ChoosePasswordCard({ title, lead, username, onSave, saveLabel = 'Save and continue', notice, footer, className = '' }: { title: string; lead: React.ReactNode; username?: string; onSave: (password: string) => Promise<string | null | undefined>; saveLabel?: string; notice?: React.ReactNode; footer?: React.ReactNode; className?: string }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (saving) return;
        setError('');
        if (password.length < PASSWORD_MIN) return setError(`Choose at least ${PASSWORD_MIN} characters.`);
        if (password !== confirm) return setError('The two passwords don’t match.');
        setSaving(true);
        try {
            const problem = await onSave(password);
            if (problem) setError(problem);
        } catch {
            setError('Could not save your password. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={`login-container ${className}`.trim()}>
            <div className="login-card">
                <div className="login-header">
                    <h1>{title}</h1>
                    <p>{lead}</p>
                </div>
                <form onSubmit={submit} className="login-form">
                    <input type="text" value={username || ''} autoComplete="username" readOnly hidden />
                    <div className="form-group">
                        <label htmlFor="cp-password"><Lock size={18} />New password</label>
                        <input id="cp-password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} placeholder={`At least ${PASSWORD_MIN} characters`} required minLength={PASSWORD_MIN} autoComplete="new-password" autoFocus />
                    </div>
                    <div className="form-group">
                        <label htmlFor="cp-confirm"><Lock size={18} />Type it again</label>
                        <input id="cp-confirm" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(''); }} required autoComplete="new-password" />
                    </div>
                    {notice && !error && <div className="login-notice" role="status">{notice}</div>}
                    {error && <div className="error-message" role="alert">{error}</div>}
                    <button type="submit" className="login-submit-btn" disabled={saving}>{saving ? 'Saving…' : saveLabel}</button>
                    {footer}
                </form>
            </div>
        </div>
    );
}
