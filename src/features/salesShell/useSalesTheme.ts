import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const savedTheme = (): Theme => {
    try {
        const saved = localStorage.getItem('checkin_theme');
        return saved === 'dark' ? 'dark' : 'light';
    } catch {
        return 'light';
    }
};

/**
 * The staff screens' light / dark theme: saved in `checkin_theme`, shared
 * with the check-in page and other tabs (the storage and
 * `checkin_theme_changed` events), and shown as `body.light-theme-active`.
 * Moved out of SalesPage unchanged (2026-10-24).
 */
export function useSalesTheme() {
    const [theme, setTheme] = useState<Theme>(savedTheme);

    useEffect(() => {
        const handleThemeChange = () => {
            try {
                const saved = localStorage.getItem('checkin_theme');
                setTheme(saved === 'dark' ? 'dark' : 'light');
            } catch { /* not fatal — carry on */ }
        };
        window.addEventListener('storage', handleThemeChange);
        window.addEventListener('checkin_theme_changed', handleThemeChange);
        return () => {
            window.removeEventListener('storage', handleThemeChange);
            window.removeEventListener('checkin_theme_changed', handleThemeChange);
        };
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem('checkin_theme', newTheme);
            setTheme(newTheme);
            window.dispatchEvent(new Event('checkin_theme_changed'));
        } catch (e) {
            console.error('Failed to save theme setting', e);
        }
    };

    useEffect(() => {
        if (theme === 'light') {
            document.body.classList.add('light-theme-active');
        } else {
            document.body.classList.remove('light-theme-active');
        }
        return () => {
            document.body.classList.remove('light-theme-active');
        };
    }, [theme]);

    return { theme, toggleTheme };
}
