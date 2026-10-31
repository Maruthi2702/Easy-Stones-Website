import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { setAuthToken } from '../api/authToken';
import ChoosePasswordCard from '../components/ChoosePasswordCard';
import useSignInTheme from '../components/useSignInTheme';
import './LoginPage.css';

/**
 * Where an emailed link lands (/set-password?token=…; links sent before
 * 2026-10-15 say /admin/set-password, which still works) — a new account's
 * invite, or an Edit user "Email a link" reset. They pick a password and are
 * signed straight in, on /sales (or /checkin for a check-in-only login).
 * The link works once and expires after 7 days (src/routes/userOnboarding.ts).
 */
const SetPasswordPage = () => {
    const navigate = useNavigate();
    const { user, completeLogin } = useAuth();
    const token = (() => {
        try {
            return new URLSearchParams(window.location.search).get('token') || '';
        } catch {
            return '';
        }
    })();
    const [invite, setInvite] = useState<{ state: string; name?: string; username?: string }>({ state: token ? 'checking' : 'invalid' });
    useSignInTheme();

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

    const save = async (newPassword: string) => {
        const res = await fetch(`${API_URL}/api/auth/accept-invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            if (data.code === 'invite-invalid') setInvite({ state: 'invalid' });
            return data.message || 'Could not save your password. Please try again.';
        }
        if (data.token) setAuthToken(data.token);
        await completeLogin(data.user);
        navigate('/sales', { replace: true });
        return null;
    };

    if (invite.state === 'valid') {
        // Someone else signed in on this browser (an admin trying the link) —
        // saving signs them out and this person in.
        const otherUser = user && user.username && user.username !== invite.username;
        return (
            <ChoosePasswordCard
                title="Choose your password"
                lead={<>Hi {invite.name} — pick a password for <strong>{invite.username}</strong>.</>}
                username={invite.username}
                onSave={save}
                notice={otherUser ? `You’re signed in as ${user.contactName || user.username}. Saving signs you in as ${invite.username} instead.` : null}
            />
        );
    }

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <h1>{invite.state === 'checking' ? 'Checking your link…' : invite.state === 'error' ? 'Something went wrong' : 'This link has expired'}</h1>
                    <p>
                        {invite.state === 'checking' ? 'One moment.'
                            : invite.state === 'error' ? 'We couldn’t check your link. Check your connection and try again.'
                            : 'Invite links work once and expire after 7 days. Ask an administrator to send you a new one.'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SetPasswordPage;
