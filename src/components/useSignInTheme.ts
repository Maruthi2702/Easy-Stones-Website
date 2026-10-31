import { useEffect } from 'react';

/** The sign-in pages' light/dark theme, for a page showing ChoosePasswordCard. */
export default function useSignInTheme() {
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
}
