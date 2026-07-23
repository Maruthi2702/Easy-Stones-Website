import React, { useState, useEffect } from 'react';
import { 
  User, Phone, Mail, MapPin, Building, 
  UserCheck, Send, Loader2, CheckCircle2, AlertTriangle,
  Sun, Moon, ChevronDown
} from 'lucide-react';
import { API_URL } from '../config/api';
import { formatPhoneInput } from '../utils/phoneUtils';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './CheckInPage.css';

const CheckInPage = ({ isSelfCheckIn = false }) => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const urlParams = new URLSearchParams(window.location.search);
  const isSelf = isSelfCheckIn || urlParams.get('mode') === 'self' || urlParams.get('mode') === 'qr' || urlParams.get('mode') === 'nfc' || window.location.pathname === '/self-checkin';

  useEffect(() => {
    if (!authLoading && !user && !isSelf) {
      navigate('/login?redirect=/checkin');
    }
  }, [user, authLoading, navigate, isSelf]);

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'dark' ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  });

  // Anti-Bot Silent Verification States
  const [honeypot, setHoneypot] = useState('');
  const [formLoadTime] = useState(Date.now());

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
        setTheme(saved === 'dark' ? 'dark' : 'light');
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('checkin_theme_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('checkin_theme_changed', handleStorageChange);
    };
  }, []);

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

  const [availableLocations, setAvailableLocations] = useState(['Seattle', 'Spokane', 'Salt Lake City']);
  
  const hasMultipleLocations = (user && (user.assignedLocations?.includes('*') || user.assignedLocations?.length > 1)) || isSelf;
  
  const allowedLocations = (user?.assignedLocations?.includes('*') || isSelf)
    ? availableLocations
    : availableLocations.filter(loc => user?.assignedLocations?.includes(loc));

  const [selectedLocation, setSelectedLocation] = useState(() => {
    try {
      const locParam = new URLSearchParams(window.location.search).get('location');
      if (locParam) {
        return locParam;
      }
      const saved = localStorage.getItem('kiosk_location');
      if (saved) {
        return saved;
      }
    } catch (e) {}
    
    if (user?.assignedLocations) {
      const primaryLoc = user.assignedLocations.find(l => l !== '*');
      if (primaryLoc) {
        return primaryLoc;
      }
    }
    
    return 'Seattle';
  });

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/locations`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            const locNames = data.map(l => l.name);
            setAvailableLocations(locNames);
            
            const urlLoc = new URLSearchParams(window.location.search).get('location');
            if (urlLoc) {
              setSelectedLocation(urlLoc);
            } else {
              setSelectedLocation(prev => {
                if (locNames.includes(prev)) {
                  return prev;
                }
                return locNames[0] || 'Seattle';
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to load locations, using defaults:', err);
      }
    };
    loadLocations();
  }, [user, isSelf]);

  useEffect(() => {
    if (selectedLocation) {
      try {
        localStorage.setItem('kiosk_location', selectedLocation);
      } catch (e) {}
    }
  }, [selectedLocation]);

  // Background warm-up ping to wake up Render server
  useEffect(() => {
    fetch(`${API_URL}/api/salesreps`)
      .then(() => console.log('⚡ Render backend warmed up successfully.'))
      .catch(err => console.warn('Backend warm-up ping failed:', err));
  }, []);

  // Parse location parameter on mount and save to localStorage
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const locParam = urlParams.get('location');
      if (locParam && availableLocations.includes(locParam)) {
        if (!user || user.assignedLocations?.includes('*') || user.assignedLocations?.includes(locParam) || isSelf) {
          localStorage.setItem('kiosk_location', locParam);
          setSelectedLocation(locParam);
          console.log(`📍 Kiosk location configured: ${locParam}`);
        }
      }
    } catch (e) {
      console.error('Error reading location parameter:', e);
    }
  }, [user, isSelf, availableLocations]);

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

    // 🛡️ Silent Anti-Bot Verification 1: Honeypot check
    if (honeypot) {
      console.warn('🤖 Bot submission detected via honeypot.');
      setSubmitted(true);
      return;
    }

    // 🛡️ Silent Anti-Bot Verification 2: Velocity check (< 1.2s is bot)
    if (Date.now() - formLoadTime < 1200) {
      console.warn('🤖 Bot submission detected via fast velocity.');
      setError('Please take a moment before submitting.');
      return;
    }

    if (!formData.name || !formData.phone || !formData.fabricatorCompany || !formData.fabricatorPhone) {
      setError('Your Name, Phone Number, Company/Contact Name, and Company Phone Number are mandatory');
      return;
    }

    const cleanUserPhone = formData.phone.replace(/\D/g, '');
    const cleanFabPhone = formData.fabricatorPhone.replace(/\D/g, '');

    if (cleanUserPhone.length < 10) {
      setError('Please enter a valid 10-digit Phone Number');
      return;
    }
    if (cleanFabPhone.length < 10) {
      setError('Please enter a valid 10-digit Company Phone Number');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const authHeader = localStorage.getItem('token') ? { 'Authorization': `Bearer ${localStorage.getItem('token')}` } : {};
      const response = await fetch(`${API_URL}/api/checkin`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify({
          ...formData,
          location: selectedLocation,
          loggedBy: isSelf ? 'Self Check-In (QR/NFC)' : (user?.username || 'Staff'),
          source: isSelf ? 'Self Check-In (QR/NFC)' : 'Staff',
          isSelfCheckIn: isSelf
        }),
        credentials: 'include'
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

  if (authLoading && !isSelf) {
    return (
      <div className="checkin-loading" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a' }}>
        <Loader2 className="animate-spin" size={48} style={{ color: '#d4af37' }} />
      </div>
    );
  }

  if (!user && !isSelf) {
    return null;
  }

  return (
    <div className={`checkin-container ${theme}-theme`}>

      <div className="checkin-header">
        <div className="logo-section">
          <h1>Visitor Check-in</h1>
          {hasMultipleLocations ? (
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <span style={{ 
                fontSize: '0.8rem', 
                color: 'var(--text-secondary)', 
                fontWeight: '600', 
                textTransform: 'uppercase', 
                letterSpacing: '0.08em' 
              }}>
                Select Active Branch Office
              </span>
              
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  style={{
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1.5px solid var(--accent-primary)',
                    padding: '12px 40px 12px 20px',
                    borderRadius: '14px',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    outline: 'none',
                    fontWeight: '700',
                    boxShadow: 'var(--shadow-glow)',
                    minWidth: '240px',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    transition: 'all 0.2s',
                    textAlign: 'left'
                  }}
                  className="kiosk-location-dropdown"
                >
                  {allowedLocations.map(loc => (
                    <option key={loc} value={loc} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                      📍 {loc} Office
                    </option>
                  ))}
                </select>
                <div style={{
                  position: 'absolute',
                  right: '16px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <ChevronDown size={18} />
                </div>
              </div>
            </div>
          ) : (
            <p className="kiosk-branch-indicator" style={{ color: '#d4af37', fontSize: '1.1rem', marginTop: '6px', fontWeight: '600', letterSpacing: '0.05em' }}>
              📍 {selectedLocation} Branch
            </p>
          )}
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
            {/* 🛡️ Silent Anti-Bot Honeypot Field */}
            <input
              type="text"
              name="website_hp"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              style={{ display: 'none' }}
              tabIndex={-1}
              autoComplete="off"
            />
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
