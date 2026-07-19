import React, { useState } from 'react';
import { User, Lock, Shield, MapPin, Eye, EyeOff, Loader2, LayoutDashboard } from 'lucide-react';
import { API_URL } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import './UserProfileTab.css';

const UserProfileTab = ({ sidebarToggle, handleGoHome }) => {
    const { user } = useAuth();
    const [formData, setFormData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
    });
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState(null); // { type: 'success' | 'error', text: string }

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage(null);

        if (!formData.currentPassword || !formData.newPassword || !formData.confirmNewPassword) {
            setMessage({ type: 'error', text: 'All password fields are required.' });
            return;
        }

        if (formData.newPassword !== formData.confirmNewPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match.' });
            return;
        }

        if (formData.newPassword.length < 6) {
            setMessage({ type: 'error', text: 'New password must be at least 6 characters long.' });
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch(`${API_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    currentPassword: formData.currentPassword,
                    newPassword: formData.newPassword
                })
            });

            const data = await response.json();

            if (response.ok) {
                setMessage({ type: 'success', text: 'Password updated successfully!' });
                setFormData({
                    currentPassword: '',
                    newPassword: '',
                    confirmNewPassword: ''
                });
            } else {
                setMessage({ type: 'error', text: data.message || 'Failed to update password.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Connection error. Please try again.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Format locations for display
    const renderLocations = () => {
        if (!user?.assignedLocations) return 'None';
        if (user.assignedLocations.includes('*')) return 'All Locations';
        return user.assignedLocations.join(', ');
    };

    return (
        <div className="user-profile-container">
            {/* Profile Page Header */}
            <div className="profile-page-header">
                <div className="header-left-group">
                    {sidebarToggle}
                    <h1 className="profile-page-title">My Profile</h1>
                </div>
                <div className="header-right-group">
                    <button 
                        className="profile-dashboard-btn" 
                        onClick={handleGoHome}
                        title="Back to Sales Dashboard"
                    >
                        <LayoutDashboard size={16} />
                        <span>Dashboard</span>
                    </button>
                </div>
            </div>

            <div className="profile-grid">
                {/* Information Card */}
                <div className="profile-card info-card">
                    <div className="card-header">
                        <User className="card-icon" />
                        <h2>Profile Information</h2>
                    </div>
                    <div className="profile-details">
                        <div className="detail-row">
                            <span className="detail-label">Name</span>
                            <span className="detail-value">{user?.contactName || 'N/A'}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Username</span>
                            <span className="detail-value">{user?.username || 'N/A'}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Email Address</span>
                            <span className="detail-value">{user?.email || 'N/A'}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Role</span>
                            <span className="detail-value role-badge">
                                <Shield size={14} style={{ marginRight: '4px' }} />
                                {user?.role || 'N/A'}
                            </span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Assigned Locations</span>
                            <span className="detail-value location-value">
                                <MapPin size={14} style={{ marginRight: '4px' }} />
                                {renderLocations()}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Password Change Card */}
                <div className="profile-card password-card">
                    <div className="card-header">
                        <Lock className="card-icon" />
                        <h2>Change Password</h2>
                    </div>
                    
                    {message && (
                        <div className={`profile-message-banner ${message.type}`}>
                            {message.text}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="password-form">
                        <div className="form-group">
                            <label htmlFor="currentPassword">Current Password</label>
                            <div className="password-input-wrapper">
                                <input
                                    type={showCurrentPassword ? "text" : "password"}
                                    id="currentPassword"
                                    name="currentPassword"
                                    value={formData.currentPassword}
                                    onChange={handleChange}
                                    required
                                    placeholder="Enter your current password"
                                />
                                <button
                                    type="button"
                                    className="password-toggle-btn"
                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                >
                                    {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="newPassword">New Password</label>
                            <div className="password-input-wrapper">
                                <input
                                    type={showNewPassword ? "text" : "password"}
                                    id="newPassword"
                                    name="newPassword"
                                    value={formData.newPassword}
                                    onChange={handleChange}
                                    required
                                    placeholder="Minimum 6 characters"
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    className="password-toggle-btn"
                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                >
                                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="confirmNewPassword">Confirm New Password</label>
                            <div className="password-input-wrapper">
                                <input
                                    type={showConfirmPassword ? "text" : "password"}
                                    id="confirmNewPassword"
                                    name="confirmNewPassword"
                                    value={formData.confirmNewPassword}
                                    onChange={handleChange}
                                    required
                                    placeholder="Confirm your new password"
                                />
                                <button
                                    type="button"
                                    className="password-toggle-btn"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                >
                                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <button type="submit" className="password-submit-btn" disabled={isSubmitting}>
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" style={{ marginRight: '8px' }} />
                                    Updating...
                                </>
                            ) : (
                                'Update Password'
                            )}
                        </button>
                    </form>
                </div>
            </div>

            {/* Profile Page Footer */}
            <footer className="profile-page-footer">
                <p>© 2025 Easy Stones. All rights reserved.</p>
                <div className="footer-links">
                    <a href="mailto:krish@easystones.com">Support Support</a>
                    <span>•</span>
                    <a href="/warranty">Warranty Policy</a>
                </div>
            </footer>
        </div>
    );
};

export default UserProfileTab;
