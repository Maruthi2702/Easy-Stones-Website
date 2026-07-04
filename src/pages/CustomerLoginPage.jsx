import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './CustomerLoginPage.css';

const CustomerLoginPage = () => {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        setError('');
    };

    const validateEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Client-side validation - relaxed to allow usernames
        if (!formData.email) {
            setError('Email or Username is required');
            return;
        }

        if (!formData.password) {
            setError('Password is required');
            return;
        }

        setIsSubmitting(true);
        setError('');

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
                // Redirect based on user type
                if (data.user.type === 'internal') {
                    navigate('/sales');
                } else {
                    navigate('/');
                }
            } else {
                setError(data.message || 'Authentication failed');
            }
        } catch (error) {
            setError('Connection error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="customer-login-page">
            <div className="login-container">
                <div className="login-card">
                    <div className="login-header">
                        <h1>Welcome Back</h1>
                        <p>Sign in to your account</p>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <form onSubmit={handleSubmit} className="login-form">
                        <div className="form-group">
                            <label>
                                <Mail size={18} />
                                Email or Username
                            </label>
                            <input
                                type="text"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                placeholder="Enter your email or username"
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <Lock size={18} />
                                Password
                            </label>
                            <div className="password-input-wrapper">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    required
                                    placeholder="Enter your password"
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex="-1"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <button type="submit" className="submit-btn" disabled={isSubmitting}>
                            {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

                    <div className="toggle-form">
                        <p style={{ margin: 0 }}>
                            Don't have an account? <Link to="/contact" className="contact-admin" style={{ textDecoration: 'none' }}>Contact Your Sales Rep.</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomerLoginPage;
