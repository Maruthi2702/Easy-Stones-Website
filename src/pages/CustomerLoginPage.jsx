import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Sun, Moon, AlertCircle, WifiOff, ArrowBigUp } from 'lucide-react';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './CustomerLoginPage.css';

/**
 * The one door into the portal — trade customers and staff sign in here and are
 * routed by account type afterwards. The empty half of a wide screen carries a
 * slab instead of nothing; see CustomerLoginPage.css for the two images, which
 * swap with the theme.
 */
const CustomerLoginPage = () => {
    const navigate = useNavigate();
    const { login, checkAuth } = useAuth();
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    // The panel image is set in CSS so it swaps with the theme without a repaint
    // here; the caption has to follow it. Specs are the catalogue's own.
    const SLABS = {
        light: { name: 'Calacatta Lincoln', spec: 'Quartz · Polished · 126″ × 63″ · 3cm' },
        dark: { name: 'Nero Marquina', spec: 'Quartz · Polished · 126″ × 63″ · 3cm' }
    };
    const [error, setError] = useState(null);   // { field, message, kind }
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [capsLock, setCapsLock] = useState(false);

    const readCapsLock = (e) => {
        // getModifierState is unavailable on some synthetic/mobile events.
        if (typeof e.getModifierState === 'function') {
            setCapsLock(e.getModifierState('CapsLock'));
        }
    };

    const emailRef = useRef(null);
    const passwordRef = useRef(null);

    const [theme, setTheme] = useState(() => {
        try {
            const saved = localStorage.getItem('checkin_theme');
            return saved === 'dark' ? 'dark' : 'light';
        } catch (e) {
            return 'light';
        }
    });

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

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        setError(null);
    };

    // Put the cursor back where the problem is, so a keyboard user can just retype.
    const fail = (field, message, kind = 'auth') => {
        setError({ field, message, kind });
        if (field === 'email') emailRef.current?.focus();
        if (field === 'password') passwordRef.current?.focus();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.email) {
            return fail('email', 'Enter the email address or username you sign in with.');
        }
        if (!formData.password) {
            return fail('password', 'Enter your password.');
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch(`${API_URL}/api/customer/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                // Update auth context with user data
                login(data.user);
                await checkAuth();
                // Redirect based on user type
                const urlParams = new URLSearchParams(window.location.search);
                const redirectUrl = urlParams.get('redirect');
                if (redirectUrl) {
                    navigate(redirectUrl);
                } else if (data.user.type === 'internal') {
                    navigate('/sales');
                } else {
                    navigate('/');
                }
            } else {
                // The server returns one message for both a bad account and a bad
                // password on purpose — don't guess which, but do say what to do next.
                fail('password', data.message || "That didn't match an account. Check both fields and try again.");
            }
        } catch (error) {
            setError({
                field: null,
                kind: 'network',
                message: "Couldn't reach the server. Check your connection and try again."
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // :focus-within carries the accent, so it holds while the reveal toggle
    // inside the field takes focus.
    const fieldClass = (name) => 'login-input' + (error?.field === name ? ' is-invalid' : '');

    return (
        <div className="customer-login-page">
            <div className="login-split">

                {/* Slab panel — the product, doing the work an empty half-screen wouldn't */}
                <aside className="login-slab" aria-hidden="true">
                    <div className="login-slab-inner">
                        <div className="login-slab-caption">
                            <p className="login-slab-name">{SLABS[theme].name}</p>
                            <p className="login-slab-spec">{SLABS[theme].spec}</p>
                        </div>
                    </div>
                </aside>

                {/* Form panel */}
                <div className="login-panel">
                    <div className="login-panel-top">
                        <button
                            type="button"
                            className="login-theme-btn"
                            onClick={toggleTheme}
                            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                        >
                            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                        </button>
                    </div>

                    <div className="login-panel-center">
                        <div className="login-form-wrap">
                            <p className="login-kicker">Customer &amp; staff portal</p>
                            <h1 className="login-title">Welcome back</h1>

                            {error && (
                                <div className="login-error" role="alert">
                                    {error.kind === 'network'
                                        ? <WifiOff size={17} className="login-error-icon" />
                                        : <AlertCircle size={17} className="login-error-icon" />}
                                    <span>{error.message}</span>
                                </div>
                            )}

                            {/* Not .login-form — index.css paints a grey background on any
                                input under that class, which showed as a seam against this
                                field's own surface. The admin login still relies on it. */}
                            <form onSubmit={handleSubmit} className="login-fields" noValidate>
                                <div className="login-field">
                                    <div className="login-label-row">
                                        <label htmlFor="login-email">Email or username</label>
                                    </div>
                                    <div className={fieldClass('email')}>
                                        <Mail size={16} className="login-input-icon" />
                                        <input
                                            id="login-email"
                                            ref={emailRef}
                                            type="text"
                                            name="email"
                                            autoComplete="username"
                                            value={formData.email}
                                            onChange={handleChange}
                                            placeholder="you@company.com"
                                        />
                                    </div>
                                </div>

                                <div className="login-field">
                                    <div className="login-label-row">
                                        <label htmlFor="login-password">Password</label>
                                        <Link to="/contact" className="login-help-link">Need help?</Link>
                                    </div>
                                    <div className={fieldClass('password')}>
                                        <Lock size={16} className="login-input-icon" />
                                        <input
                                            id="login-password"
                                            ref={passwordRef}
                                            type={showPassword ? 'text' : 'password'}
                                            name="password"
                                            autoComplete="current-password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            onKeyUp={readCapsLock}
                                            onKeyDown={readCapsLock}
                                            onBlur={() => setCapsLock(false)}
                                            placeholder="Enter your password"
                                        />
                                        <button
                                            type="button"
                                            className="login-eye"
                                            onClick={() => setShowPassword(!showPassword)}
                                            tabIndex="-1"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    {/* Silently mistyping a password because Caps Lock is on is
                                        one of the commonest reasons a correct password fails. */}
                                    {capsLock && (
                                        <p className="login-caps">
                                            <ArrowBigUp size={14} /> Caps Lock is on
                                        </p>
                                    )}
                                </div>

                                <button type="submit" className="login-submit" disabled={isSubmitting}>
                                    <span className="login-submit-label">
                                        {isSubmitting && <span className="login-spinner" aria-hidden="true" />}
                                        {isSubmitting ? 'Signing you in…' : 'Sign In'}
                                    </span>
                                </button>
                            </form>

                            <p className="login-alt">
                                Don&apos;t have an account? <Link to="/contact">Contact your sales rep</Link>
                            </p>
                        </div>
                    </div>

                    <div className="login-panel-foot">
                        <Link to="/warranty">Warranty</Link>
                        <Link to="/warranty?section=care">Care &amp; Maintenance</Link>
                        <Link to="/contact">Contact</Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomerLoginPage;
