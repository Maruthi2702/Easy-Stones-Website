import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_URL } from '../config/api';

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

    const checkAuth = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // First verify token and get basic info (works for both admin/customer)
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
                setUser({
                    ...userData,
                    role: userData.role || authData.role,
                    type: authData.authType === 'admin' ? 'internal' : 'customer',
                    contactName: userData.contactName || userData.username || userData.email
                });
            } else {
                setUser(null);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            setUser(null);
        } finally {
            setLoading(false);
        }
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
            if (e.key === 'auth_logout_event' || (e.key === 'token' && !e.newValue)) {
                console.log('Cross-tab logout event received');
                setUser(null);
            } else if (e.key === 'auth_login_event' || (e.key === 'token' && e.newValue)) {
                console.log('Cross-tab login event received');
                checkAuth();
            }
        };

        window.addEventListener('storage', handleStorageChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
        };
    }, []);

    const login = (userData) => {
        localStorage.setItem('auth_login_event', Date.now().toString());
        setUser(userData);
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
            localStorage.removeItem('token');
            localStorage.setItem('auth_logout_event', Date.now().toString());
            setUser(null);
        }
    };

    const value = {
        user,
        loading,
        login,
        logout,
        checkAuth
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
