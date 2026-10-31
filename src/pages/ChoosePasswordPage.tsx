import React from 'react';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { setAuthToken } from '../api/authToken';
import ChoosePasswordCard from '../components/ChoosePasswordCard';
import useSignInTheme from '../components/useSignInTheme';

/**
 * What every staff page (ProtectedRoute) shows while this browser is signed in
 * with a temporary password: choose your own, then the page you were going to
 * — /sales, or /checkin for a check-in-only login — opens as you.
 *
 * Until then there is no real session, only a setup one that can do nothing
 * but this (src/services/staffSession.ts), so nothing behind it loads.
 */
const ChoosePasswordPage = () => {
    const { passwordSetup, completeLogin, logout, checkAuth } = useAuth();
    useSignInTheme();

    const save = async (newPassword: string) => {
        const res = await fetch(`${API_URL}/api/auth/first-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            // The 30 minutes ran out, or an admin reset it meanwhile: back to
            // sign-in (checkAuth finds no setup session any more).
            if (data.code === 'setup-expired') {
                try { sessionStorage.setItem('auth_session_expired', '1'); } catch { /* notice only */ }
                await checkAuth({ silent: true });
                return null;
            }
            return data.message || 'Could not save your password. Please try again.';
        }
        if (data.token) setAuthToken(data.token);
        await completeLogin(data.user);
        return null;
    };

    return (
        <ChoosePasswordCard
            className="login-container--gate"
            title="Choose your password"
            lead={<>Welcome, {passwordSetup?.name}. You signed in with a temporary password — pick your own to continue.</>}
            username={passwordSetup?.username}
            onSave={save}
            footer={<button type="button" className="login-back-btn" onClick={logout}>Sign out</button>}
        />
    );
};

export default ChoosePasswordPage;
