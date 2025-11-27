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
            const response = await fetch(`${API_URL}/api/customer/me`, {
                credentials: 'include'
            });

            if (response.ok) {
                const userData = await response.json();
                setUser(userData);
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

        const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
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
            await fetch(`${API_URL}/api/customer/logout`, {
                method: 'POST',
                credentials: 'include'
            });
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
