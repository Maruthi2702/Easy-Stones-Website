import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_URL } from '../config/api';
import { resetSessionExpiredGuard } from '../api/authFetch';
import { getAuthToken, setAuthToken, clearAuthToken } from '../api/authToken';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Check if user is logged in on mount
    useEffect(() => {
        checkAuth();
    }, []);

    /**
     * Re-read the session and full profile. Resolves to the user it set, or
     * null when there's no session.
     *
     * `silent` skips the app-wide loading state. Every ProtectedRoute swaps
     * its page for a spinner while `loading` is true, so a re-check that
     * flipped it — the cross-tab login sync — tore down whatever screen was
     * open and rebuilt it, refetching everything, only to land on the same
     * user. Only the very first check, when nobody knows who's signed in yet,
     * needs to hold the page back.
     */
    const checkAuth = async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        try {
            const token = getAuthToken();
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // First verify token and get basic info (works for both admin/customer).
            // Always 200 (with { valid: false } for a logged-out visitor) — this
            // runs on every page including anonymous ones (the self-checkin
            // kiosk, /login itself), so it never has to be a noisy 401 to check.
            const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
                headers,
                credentials: 'include'
            });

            if (!verifyRes.ok) {
                setUser(null);
                setLoading(false);
                return;
            }

            const authData = await verifyRes.json();

            // Server returns { valid: false } when no token is present
            if (!authData.valid) {
                setUser(null);
                setLoading(false);
                return;
            }

            // A fresh page load starts with no in-memory token (see authToken.js)
            // even for this now-confirmed-valid session — the httpOnly cookie
            // survived the reload, the memory copy didn't. Re-derive it from
            // that cookie now, before anything else needs it (the Socket.IO
            // room join in particular runs early on the delivery board). Only
            // attempted once verify has already proven a session exists, so
            // an anonymous visit never has to see this as a 401.
            if (!token) {
                try {
                    const tokenRes = await fetch(`${API_URL}/api/auth/token`, { credentials: 'include' });
                    if (tokenRes.ok) {
                        const tokenData = await tokenRes.json();
                        if (tokenData.token) setAuthToken(tokenData.token);
                    }
                } catch {
                    // Non-fatal — everything else here already works off the cookie alone
                }
            }

            // Then fetch full profile based on authType
            let profileUrl = authData.authType === 'admin'
                ? `${API_URL}/api/user/me`
                : `${API_URL}/api/customer/me`;

            const profileRes = await fetch(profileUrl, {
                headers,
                credentials: 'include'
            });

            if (profileRes.ok) {
                const userData = await profileRes.json();
                // Normalize user object for UI consistency
                const nextUser = {
                    ...userData,
                    role: userData.role || authData.role,
                    type: authData.authType === 'admin' ? 'internal' : 'customer',
                    // `name` is the server-resolved Display Name (falling back to a
                    // tidied username); prefer it over the raw lower-case login id.
                    contactName: userData.contactName || userData.name || userData.username || userData.email
                };
                setUser(nextUser);
                return nextUser;
            } else {
                setUser(null);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            setUser(null);
        } finally {
            setLoading(false);
        }
        return null;
    };

    // Auto-logout after inactivity timeout
    useEffect(() => {
        if (!user) return; // Only run if user is logged in

        const INACTIVITY_TIMEOUT = 10 * 60 * 60 * 1000; // 10 hours in milliseconds
        let inactivityTimer;

        const resetTimer = () => {
            if (inactivityTimer) {
                clearTimeout(inactivityTimer);
            }
            inactivityTimer = setTimeout(() => {
                console.log('Auto-logout due to inactivity');
                logout();
            }, INACTIVITY_TIMEOUT);
        };

        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
        events.forEach(event => {
            window.addEventListener(event, resetTimer);
        });

        resetTimer();

        return () => {
            if (inactivityTimer) {
                clearTimeout(inactivityTimer);
            }
            events.forEach(event => {
                window.removeEventListener(event, resetTimer);
            });
        };
    }, [user]);

    // Cross-tab session synchronization
    useEffect(() => {
        const handleStorageChange = (e) => {
            // 'token' dropped from these checks now that it's never written to
            // localStorage — auth_login_event/auth_logout_event are plain
            // timestamp markers set by login()/logout() below and were always
            // the other half of this OR, so cross-tab sync is unaffected.
            if (e.key === 'auth_logout_event') {
                console.log('Cross-tab logout event received');
                setUser(null);
            } else if (e.key === 'auth_login_event') {
                console.log('Cross-tab login event received');
                // Silent: a tab already open on a page keeps it mounted.
                checkAuth({ silent: true });
            }
        };

        window.addEventListener('storage', handleStorageChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
        };
    }, []);

    // Any authFetch call, anywhere, can discover the session died — this is
    // what turns that discovery into the same sign-out ProtectedRoute already
    // reacts to, instead of the page quietly continuing to act logged in.
    useEffect(() => {
        const handleSessionExpired = () => {
            logout();
        };
        window.addEventListener('auth:session-expired', handleSessionExpired);
        return () => {
            window.removeEventListener('auth:session-expired', handleSessionExpired);
        };
    }, []);

    const login = (userData) => {
        resetSessionExpiredGuard();
        localStorage.setItem('auth_login_event', Date.now().toString());
        setUser(userData);
    };

    /**
     * Finish a sign-in on this tab: load the full profile (permissions and all)
     * before any user is set, so the page it lands on mounts once.
     *
     * The login pages used to call login() with the basic user the login
     * response carries, then checkAuth() for the full profile. Setting that
     * basic user sent the login page straight on to /sales, which started
     * loading — then checkAuth flipped `loading`, ProtectedRoute swapped the
     * page for a spinner, and /sales mounted and loaded all over again once
     * the profile arrived. Falls back to login(fallbackUser) if the profile
     * can't be read, which is what happened before.
     */
    const completeLogin = async (fallbackUser) => {
        resetSessionExpiredGuard();
        const fullUser = await checkAuth({ silent: true });
        if (!fullUser) {
            login(fallbackUser);
            return fallbackUser;
        }
        localStorage.setItem('auth_login_event', Date.now().toString());
        return fullUser;
    };

    const logout = async () => {
        try {
            await Promise.all([
                fetch(`${API_URL}/api/customer/logout`, { method: 'POST', credentials: 'include' }),
                fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
            ]);
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            clearAuthToken();
            localStorage.setItem('auth_logout_event', Date.now().toString());
            setUser(null);
        }
    };

    const value = {
        user,
        loading,
        login,
        completeLogin,
        logout,
        checkAuth
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
