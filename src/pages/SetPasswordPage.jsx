import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { API_URL } from '../config/api';
import './LoginPage.css';

/**
 * Where an emailed link lands (/admin/set-password?token=…) — a new account's
 * invite, or an Edit user "Email a link" reset: they pick a password, then
 * sign in on the staff login with it.
 * The link works once and expires after 7 days (src/routes/userOnboarding.js).
 */
const SetPasswordPage = () => {
    const navigate = useNavigate();
    const token = (() => {
        try {
            return new URLSearchParams(window.location.search).get('token') || '';
        } catch {
            return '';
        }
    })();
    const [invite, setInvite] = useState({ state: token ? 'checking' : 'invalid' });
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    // Same theme the staff login uses.
    useEffect(() => {
        let theme = 'light';
        try {
            theme = localStorage.getItem('checkin_theme') === 'dark' ? 'dark' : 'light';
        } catch {
            // storage unavailable — light it is
        }
        document.body.classList.toggle('light-theme-active', theme === 'light');
        return () => document.body.classList.remove('light-theme-active');
    }, []);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        fetch(`${API_URL}/api/auth/invite/${encodeURIComponent(token)}`)
            .then((r) => r.json())
            .then((data) => {
                if (!cancelled) setInvite(data.valid ? { state: 'valid', name: data.name, username: data.username } : { state: 'invalid' });
            })
            .catch(() => { if (!cancelled) setInvite({ state: 'error' }); });
        return () => { cancelled = true; };
    }, [token]);

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (password.length < 6) return setError('Choose at least 6 characters.');
        if (password !== confirm) return setError('The two passwords don’t match.');
        setSaving(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/accept-invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword: password })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                if (data.code === 'invite-invalid') setInvite({ state: 'invalid' });
                setError(data.message || 'Could not save your password. Please try again.');
                return;
            }
            navigate(`/admin/login?invited=1&u=${encodeURIComponent(data.username)}`, { replace: true });
        } catch {
            setError('Could not save your password. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                {invite.state === 'valid' ? (
                    <>
                        <div className="login-header">
                            <h1>Choose your password</h1>
                            <p>Hi {invite.name} — pick a password for <strong>{invite.username}</strong>.</p>
                        </div>
                        <form onSubmit={submit} className="login-form">
                            <input type="text" value={invite.username} autoComplete="username" readOnly hidden />
                            <div className="form-group">
                                <label htmlFor="sp-password"><Lock size={18} />New password</label>
                                <input id="sp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} autoComplete="new-password" autoFocus />
                            </div>
                            <div className="form-group">
                                <label htmlFor="sp-confirm"><Lock size={18} />Type it again</label>
                                <input id="sp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                            </div>
                            {error && <div className="error-message">{error}</div>}
                            <button type="submit" className="login-submit-btn" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</button>
                        </form>
                    </>
                ) : (
                    <div className="login-header">
                        <h1>{invite.state === 'checking' ? 'Checking your link…' : invite.state === 'error' ? 'Something went wrong' : 'This link has expired'}</h1>
                        <p>
                            {invite.state === 'checking' ? 'One moment.'
                                : invite.state === 'error' ? 'We couldn’t check your link. Check your connection and try again.'
                                : 'Invite links work once and expire after 7 days. Ask an administrator to send you a new one.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SetPasswordPage;
