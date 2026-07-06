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
        try {
            // First verify token and get basic info (works for both admin/customer)
            const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
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

    // Auto-logout after 10 minutes of inactivity
    useEffect(() => {
        if (!user) return; // Only run if user is logged in

        const INACTIVITY_TIMEOUT = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
        let inactivityTimer;

        const resetTimer = () => {
            // Clear existing timer
            if (inactivityTimer) {
                clearTimeout(inactivityTimer);
            }

            // Set new timer
            inactivityTimer = setTimeout(() => {
                console.log('Auto-logout due to inactivity');
                logout();
            }, INACTIVITY_TIMEOUT);
        };

        // Activity events to monitor
        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

        // Add event listeners
        events.forEach(event => {
            window.addEventListener(event, resetTimer);
        });

        // Start initial timer
        resetTimer();

        // Cleanup
        return () => {
            if (inactivityTimer) {
                clearTimeout(inactivityTimer);
            }
            events.forEach(event => {
                window.removeEventListener(event, resetTimer);
            });
        };
    }, [user]);

    const login = (userData) => {
        setUser(userData);
    };

    const logout = async () => {
        try {
            // Attempt to logout from both endpoints
            await Promise.all([
                fetch(`${API_URL}/api/customer/logout`, { method: 'POST', credentials: 'include' }),
                fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
            ]);
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
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
