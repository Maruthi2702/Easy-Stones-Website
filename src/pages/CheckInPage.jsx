import React, { useState } from 'react';
import { 
  User, Phone, Mail, MapPin, Building, 
  UserCheck, Send, Loader2, CheckCircle2
} from 'lucide-react';
import { API_URL } from '../config/api';
import { formatPhoneInput } from '../utils/phoneUtils';
import './CheckInPage.css';

const CheckInPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    fabricatorCompany: '',
    fabricatorName: '',
    fabricatorPhone: ''
  });

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone' || name === 'fabricatorPhone') {
      setFormData(prev => ({ ...prev, [name]: formatPhoneInput(value) }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.fabricatorCompany || !formData.fabricatorPhone) {
      setError('Your Name, Phone Number, Company Name, and Company Phone Number are mandatory');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Reset form after success message
        setTimeout(() => {
          setSubmitted(false);
          setFormData({
            name: '',
            phone: '',
            email: '',
            fabricatorCompany: '',
            fabricatorName: '',
            fabricatorPhone: ''
          });
        }, 5000);
      } else {
        const data = await response.json();
        setError(data.message || 'Check-in failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="checkin-container">
      <div className="checkin-header">
        <div className="logo-section">
          <h1>Visitor Check-in</h1>
        </div>
      </div>

      <div className="checkin-card">
        {submitted ? (
          <div className="success-message">
            <CheckCircle2 size={64} className="success-icon" />
            <h2>Welcome!</h2>
            <p>Thank you for checking in, <strong>{formData.name}</strong>.</p>
            <p>Someone will be with you shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="checkin-form">
            <div className="form-sections-container">
              <div className="form-section">
                <h3>Customer Information</h3>
                <div className="input-field">
                  <label><User size={16} /> Name <span className="required">*</span></label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Enter your full name"
                    required
                  />
                </div>
                <div className="input-field">
                  <label><Phone size={16} /> Phone Number <span className="required">*</span></label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="(555) 000-0000"
                    required
                  />
                </div>
                <div className="input-field">
                  <label><Mail size={16} /> Email Address</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="example@email.com"
                  />
                </div>
              </div>

              <div className="form-section">
                <h3>Fabricator / Contractor Information</h3>
                <div className="input-field">
                  <label><Building size={16} /> Company Name <span className="required">*</span></label>
                  <input
                    type="text"
                    name="fabricatorCompany"
                    value={formData.fabricatorCompany}
                    onChange={handleChange}
                    placeholder="Enter company name"
                    required
                  />
                </div>
                <div className="input-field">
                  <label><Phone size={16} /> Company Phone Number <span className="required">*</span></label>
                  <input
                    type="tel"
                    name="fabricatorPhone"
                    value={formData.fabricatorPhone}
                    onChange={handleChange}
                    placeholder="Enter phone number"
                    required
                  />
                </div>
                <div className="input-field">
                  <label><UserCheck size={16} /> Contact Name</label>
                  <input
                    type="text"
                    name="fabricatorName"
                    value={formData.fabricatorName}
                    onChange={handleChange}
                    placeholder="Who are you working with?"
                  />
                </div>
              </div>
            </div>

            <div className="waiver-section">
              <span className="waiver-text">
                <strong>Waiver:</strong> By checking in, I understand that I'm entering at my own risk to a working warehouse where tripping hazards as well as carbon monoxide may be present and any adult or underage child accompanying me are completely under my responsibility and to be always kept under my watch all the time.
              </span>
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <><Send size={18} /> Check In Now</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default CheckInPage;
