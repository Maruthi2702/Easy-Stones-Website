import React, { useState, useEffect } from 'react';
import { 
  User, Phone, Mail, MapPin, Building, 
  UserCheck, Send, Loader2, CheckCircle2, AlertTriangle,
  Sun, Moon
} from 'lucide-react';
import { API_URL } from '../config/api';
import { formatPhoneInput } from '../utils/phoneUtils';
import './CheckInPage.css';

const CheckInPage = () => {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem('checkin_theme', nextTheme);
      window.dispatchEvent(new Event('checkin_theme_changed'));
    } catch (err) {
      console.error('Failed to save check-in theme:', err);
    }
  };

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setTheme(saved === 'light' ? 'light' : 'dark');
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('checkin_theme_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('checkin_theme_changed', handleStorageChange);
    };
  }, []);

  const [formData, setFormData] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_draft');
      return saved ? JSON.parse(saved) : {
        name: '',
        phone: '',
        fabricatorCompany: '',
        fabricatorPhone: ''
      };
    } catch (e) {
      return {
        name: '',
        phone: '',
        fabricatorCompany: '',
        fabricatorPhone: ''
      };
    }
  });

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Background warm-up ping to wake up Render server
  useEffect(() => {
    fetch(`${API_URL}/api/salesreps`)
      .then(() => console.log('⚡ Render backend warmed up successfully.'))
      .catch(err => console.warn('Backend warm-up ping failed:', err));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let formattedVal = value;
    if (name === 'phone' || name === 'fabricatorPhone') {
      formattedVal = formatPhoneInput(value);
    }
    
    setFormData(prev => {
      const next = { ...prev, [name]: formattedVal };
      try {
        localStorage.setItem('checkin_draft', JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save check-in draft:', err);
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.fabricatorCompany || !formData.fabricatorPhone) {
      setError('Your Name, Phone Number, Company/Contact Name, and Company Phone Number are mandatory');
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
        try {
          localStorage.removeItem('checkin_draft');
        } catch (err) {
          console.error('Failed to clear check-in draft:', err);
        }
        // Scroll to top immediately to bypass iOS virtual keyboard dismissal conflict
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;

        // Delayed fallback scroll to ensure page goes to top after keyboard fully retracts
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          document.body.scrollTop = 0;
          document.documentElement.scrollTop = 0;
        }, 300);
        // Reset form after success message
        setTimeout(() => {
          setSubmitted(false);
          setFormData({
            name: '',
            phone: '',
            fabricatorCompany: '',
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
    <div className={`checkin-container ${theme}-theme`}>
      <button type="button" onClick={toggleTheme} className="theme-toggle-btn" aria-label="Toggle Theme">
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
      </button>

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
              </div>

              <div className="form-section">
                <h3>Fabricator / Contractor Information</h3>
                <div className="input-field">
                  <label><Building size={16} /> Company/Contact Name <span className="required">*</span></label>
                  <input
                    type="text"
                    name="fabricatorCompany"
                    value={formData.fabricatorCompany}
                    onChange={handleChange}
                    placeholder="Enter company/contact name"
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
              </div>
            </div>

            <div className="waiver-section">
              <AlertTriangle size={20} className="waiver-icon" />
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
