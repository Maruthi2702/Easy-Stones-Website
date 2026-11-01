import { createContext, useContext } from 'react';
import type { CurrentUser } from '../types/records';

/** The signed-in person: staff ('internal') or a website customer. */
export type AuthUser = CurrentUser & {
    type: 'internal' | 'customer';
    contactName?: string;
};

/** A browser mid first password (a setup session — src/services/staffSession.ts). */
export type PasswordSetup = { username: string; name?: string };

export type AuthContextValue = {
    user: AuthUser | null;
    loading: boolean;
    passwordSetup: PasswordSetup | null;
    authError: string | null;
    retryAuth: () => void;
    startPasswordSetup: () => Promise<PasswordSetup | null>;
    login: (userData: AuthUser) => void;
    completeLogin: (fallbackUser: AuthUser) => Promise<AuthUser>;
    logout: () => Promise<void>;
    checkAuth: (opts?: { silent?: boolean }) => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};


export default AuthContext;
