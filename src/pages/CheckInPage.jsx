import React, { useState, useEffect } from 'react';
import { 
  User, Phone, Building, CheckCircle2, ShieldCheck,
  Sun, Moon, ChevronRight, ChevronLeft, Home, Hammer, Palette, HardHat, Wrench, Store,
  Send, Loader2, AlertTriangle, ChevronDown, UserCheck
} from 'lucide-react';
import { API_URL } from '../config/api';
import { formatPhoneInput } from '../utils/phoneUtils';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './CheckInPage.css';

const VISITOR_TYPES = [
  { id: 'Homeowner', label: 'Homeowner', icon: Home, desc: 'Selecting stone for your home' },
  { id: 'Fabricator', label: 'Fabricator', icon: Hammer, desc: 'Countertop fabrication partner' },
  { id: 'Designer', label: 'Designer', icon: Palette, desc: 'Interior designer or architect' },
  { id: 'Contractor', label: 'Contractor', icon: HardHat, desc: 'General contractor or remodeler' },
  { id: 'Builder', label: 'Builder', icon: Wrench, desc: 'Custom home builder or developer' },
  { id: 'Dealer', label: 'Dealer', icon: Store, desc: 'Retail stone or tile dealer' }
];

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

  const [honeypot, setHoneypot] = useState('');
  const [formLoadTime] = useState(Date.now());
  const [step, setStep] = useState(1);

  const [staffFormData, setStaffFormData] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_draft');
      return saved ? JSON.parse(saved) : { name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' };
    } catch (e) {
      return { name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' };
    }
  });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [fabricatorPhone, setFabricatorPhone] = useState('');
  const [preferredFabricators, setPreferredFabricators] = useState('');
  const [ndaAccepted, setNdaAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const [availableLocations, setAvailableLocations] = useState(['Seattle', 'Spokane', 'Salt Lake City']);
  
  const urlLocationParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('location') : null;
  const isLockedLocation = isSelf || Boolean(urlLocationParam);
  const hasMultipleLocations = !isLockedLocation && (user && (user.assignedLocations?.includes('*') || user.assignedLocations?.length > 1));
  
  const allowedLocations = (user?.assignedLocations?.includes('*') || isSelf)
    ? availableLocations
    : availableLocations.filter(loc => user?.assignedLocations?.includes(loc));

  const [selectedLocation, setSelectedLocation] = useState(() => {
    try {
      const locParam = new URLSearchParams(window.location.search).get('location');
      if (locParam) return locParam;
      const saved = localStorage.getItem('kiosk_location');
      if (saved && !isSelf) return saved;
    } catch (e) {}
    if (user?.assignedLocations) {
      const primaryLoc = user.assignedLocations.find(l => l !== '*');
      if (primaryLoc) return primaryLoc;
    }
    return 'Seattle';
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem('checkin_theme', nextTheme);
      window.dispatchEvent(new Event('checkin_theme_changed'));
    } catch (err) {}
  };

  useEffect(() => {
    const sync = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setTheme(saved === 'dark' ? 'dark' : 'light');
      } catch (e) {}
    };
    window.addEventListener('storage', sync);
    window.addEventListener('checkin_theme_changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('checkin_theme_changed', sync);
    };
  }, []);

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme-active');
    } else {
      document.body.classList.remove('light-theme-active');
    }
    return () => document.body.classList.remove('light-theme-active');
  }, [theme]);

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/locations`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data?.length > 0) {
            setAvailableLocations(data.map(l => l.name));
            const urlLoc = new URLSearchParams(window.location.search).get('location');
            if (urlLoc) setSelectedLocation(urlLoc);
          }
        }
      } catch (err) {}
    };
    loadLocations();
  }, [user, isSelf]);

  useEffect(() => { fetch(`${API_URL}/api/salesreps`).catch(() => {}); }, []);

  // Auto-reset for success
  const [resetTimer, setResetTimer] = useState(6);
  useEffect(() => {
    let interval = null;
    if (isSelf && step === 8) {
      setResetTimer(6);
      interval = setInterval(() => {
        setResetTimer(prev => {
          if (prev <= 1) { clearInterval(interval); resetSelfForm(); return 6; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isSelf, step]);

  const resetSelfForm = () => {
    setName(''); setPhone(''); setVisitorType('');
    setCompanyName(''); setFabricatorPhone('');
    setPreferredFabricators(''); setNdaAccepted(false);
    setError(null); setStep(1);
  };

  const handleNextStep = () => {
    setError(null);
    if (step === 2 && !name.trim()) { setError('Please enter your full name'); return; }
    if (step === 3) {
      const clean = phone.replace(/\D/g, '');
      if (clean.length < 10) { setError('Please enter a valid 10-digit phone number'); return; }
    }
    if (step === 4 && !visitorType) { setError('Please select your visitor type'); return; }
    setStep(prev => prev + 1);
  };

  const handlePrevStep = () => { setError(null); if (step > 1) setStep(prev => prev - 1); };

  const handleSelfSubmit = async (e) => {
    if (e) e.preventDefault();
    if (honeypot) { setStep(8); return; }
    if (Date.now() - formLoadTime < 1200) { setError('Please take a moment before submitting.'); return; }
    if (!ndaAccepted) { setError('Please accept the Safety Rules & NDA terms.'); return; }

    setLoading(true); setError(null);
    let finalFabCompany = companyName.trim();
    let finalFabPhone = fabricatorPhone.trim();

    if (['Designer', 'Contractor', 'Builder', 'Dealer'].includes(visitorType)) {
      if (preferredFabricators.trim()) {
        finalFabPhone = `Preferred: ${preferredFabricators.trim()}${fabricatorPhone ? ` | ${fabricatorPhone}` : ''}`;
      }
    }

    try {
      const response = await fetch(`${API_URL}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(),
          fabricatorCompany: finalFabCompany || `${visitorType} Visit`,
          fabricatorPhone: finalFabPhone || 'N/A',
          location: selectedLocation,
          loggedBy: 'Self Check-In (QR/NFC)', source: 'Self Check-In (QR/NFC)',
          visitorType, isSelfCheckIn: true
        })
      });
      if (response.ok) { setStep(8); }
      else { const data = await response.json(); setError(data.message || 'Check-in failed. Please try again.'); }
    } catch (err) { setError('Network error. Please check your connection.'); }
    finally { setLoading(false); }
  };

  const handleStaffChange = (e) => {
    const { name, value } = e.target;
    let v = (name === 'phone' || name === 'fabricatorPhone') ? formatPhoneInput(value) : value;
    setStaffFormData(prev => {
      const next = { ...prev, [name]: v };
      try { localStorage.setItem('checkin_draft', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  const handleStaffSubmit = async (e) => {
    e.preventDefault();
    if (!staffFormData.name || !staffFormData.phone || !staffFormData.fabricatorCompany || !staffFormData.fabricatorPhone) {
      setError('All fields are required'); return;
    }
    if (staffFormData.phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit phone number'); return; }
    if (staffFormData.fabricatorPhone.replace(/\D/g, '').length < 10) { setError('Enter a valid company phone number'); return; }

    setLoading(true); setError(null);
    try {
      const authHeader = localStorage.getItem('token') ? { 'Authorization': `Bearer ${localStorage.getItem('token')}` } : {};
      const response = await fetch(`${API_URL}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...staffFormData, location: selectedLocation, loggedBy: user?.username || user?.name || 'Staff' }),
        credentials: 'include'
      });
      if (response.ok) {
        setSubmitted(true);
        setStaffFormData({ name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' });
        try { localStorage.removeItem('checkin_draft'); } catch (e) {}
      } else { const data = await response.json(); setError(data.message || 'Check-in failed'); }
    } catch (err) { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  if (!user && !isSelf) return null;

  const locationDisplay = selectedLocation.includes('Showroom') || selectedLocation.includes('Branch') || selectedLocation.includes('Office')
    ? selectedLocation : `${selectedLocation} Showroom`;

  // ═══════════════════════════════════════════════════════
  // RENDER 1: SELF CHECK-IN KIOSK (Full-Screen)
  // ═══════════════════════════════════════════════════════
  if (isSelf) {
    return (
      <div className={`kiosk-fullscreen ${theme}-theme`}>
        {/* ── Top Bar ── */}
        <div className="kiosk-topbar">
          <span className="kiosk-topbar-brand">Easy Stones — {locationDisplay}</span>
        </div>

        {/* ── Center Stage ── */}
        <div className="kiosk-center-stage">
          {/* Honeypot */}
          <input type="text" name="website_hp" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
          
          {error && <div className="kiosk-error-msg anim-slide-up">⚠️ {error}</div>}

          {/* STEP 1: Logo Welcome (logo in center, company name at top) */}
          {step === 1 && (
            <div className="kiosk-welcome-stage anim-fade-in">
              <div className="kiosk-logo-display">
                <img src="/logo.png" alt="Easy Stones" />
              </div>
            </div>
          )}

          {/* STEP 2: Name */}
          {step === 2 && (
            <div className="kiosk-form-step anim-slide-up" key="step-2">
              <img src="/logo.png" alt="Easy Stones" className="kiosk-step-logo" />
              <div className="kiosk-step-indicator">Step 1 of 6</div>
              <h2 className="kiosk-step-question">What is your full name?</h2>
              <p className="kiosk-step-hint">Please enter your first and last name</p>
              <div className="kiosk-input-wrap">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" className="kiosk-input-big" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && handleNextStep()} />
              </div>
            </div>
          )}

          {/* STEP 3: Phone */}
          {step === 3 && (
            <div className="kiosk-form-step anim-slide-up" key="step-3">
              <img src="/logo.png" alt="Easy Stones" className="kiosk-step-logo" />
              <div className="kiosk-step-indicator">Step 2 of 6</div>
              <h2 className="kiosk-step-question">What is your phone number?</h2>
              <p className="kiosk-step-hint">We'll use this to notify your sales specialist</p>
              <div className="kiosk-input-wrap">
                <input type="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="(555) 000-0000" className="kiosk-input-big" autoFocus onKeyDown={(e) => e.key === 'Enter' && phone.replace(/\D/g, '').length >= 10 && handleNextStep()} />
              </div>
            </div>
          )}

          {/* STEP 4: Visitor Type */}
          {step === 4 && (
            <div className="kiosk-form-step anim-slide-up" key="step-4" style={{ maxWidth: '640px' }}>
              <img src="/logo.png" alt="Easy Stones" className="kiosk-step-logo" />
              <div className="kiosk-step-indicator">Step 3 of 6</div>
              <h2 className="kiosk-step-question">What type of visitor are you?</h2>
              <p className="kiosk-step-hint">Select the option that best describes you</p>
              <div className="kiosk-type-grid">
                {VISITOR_TYPES.map(type => {
                  const Icon = type.icon;
                  return (
                    <button key={type.id} type="button" className={`kiosk-type-card ${visitorType === type.id ? 'selected' : ''}`} onClick={() => { setVisitorType(type.id); setError(null); }}>
                      <div className="kiosk-type-icon"><Icon size={21} /></div>
                      <div className="kiosk-type-info">
                        <span className="kiosk-type-name">{type.label}</span>
                        <span className="kiosk-type-sub">{type.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 5: Company */}
          {step === 5 && (
            <div className="kiosk-form-step anim-slide-up" key="step-5">
              <img src="/logo.png" alt="Easy Stones" className="kiosk-step-logo" />
              <div className="kiosk-step-indicator">Step 4 of 6</div>
              <h2 className="kiosk-step-question">
                {visitorType === 'Homeowner' ? 'Who is your Fabricator or Contractor?' : visitorType === 'Fabricator' ? 'What is your Company Name?' : 'What is your Business Name?'}
              </h2>
              <p className="kiosk-step-hint">
                {visitorType === 'Homeowner' ? 'Enter the company or person installing your stone' : `Enter your ${visitorType.toLowerCase()} business name`}
              </p>
              <div className="kiosk-input-wrap">
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={visitorType === 'Homeowner' ? 'e.g. Apex Granite / John Smith' : 'e.g. Premier Stone Works'} className="kiosk-input-big" autoFocus onKeyDown={(e) => e.key === 'Enter' && companyName.trim() && handleNextStep()} />
              </div>
            </div>
          )}

          {/* STEP 6: Phone / Partners */}
          {step === 6 && (
            <div className="kiosk-form-step anim-slide-up" key="step-6">
              <img src="/logo.png" alt="Easy Stones" className="kiosk-step-logo" />
              <div className="kiosk-step-indicator">Step 5 of 6</div>
              {['Homeowner', 'Fabricator'].includes(visitorType) ? (
                <>
                  <h2 className="kiosk-step-question">Company Phone Number?</h2>
                  <p className="kiosk-step-hint">Enter phone for {companyName || 'your company'}</p>
                  <div className="kiosk-input-wrap">
                    <input type="tel" value={fabricatorPhone} onChange={(e) => setFabricatorPhone(formatPhoneInput(e.target.value))} placeholder="(555) 000-0000" className="kiosk-input-big" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleNextStep()} />
                  </div>
                </>
              ) : (
                <>
                  <h2 className="kiosk-step-question">Fabricator Partners</h2>
                  <p className="kiosk-step-hint">Which stone fabricator(s) do you work with?</p>
                  <div className="kiosk-input-wrap">
                    <input type="text" value={preferredFabricators} onChange={(e) => setPreferredFabricators(e.target.value)} placeholder="e.g. Olympic Marble, NW Granite" className="kiosk-input-big" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleNextStep()} />
                  </div>
                  <div className="kiosk-input-wrap" style={{ marginTop: '1rem' }}>
                    <input type="tel" value={fabricatorPhone} onChange={(e) => setFabricatorPhone(formatPhoneInput(e.target.value))} placeholder="Company Phone (Optional)" className="kiosk-input-medium" />
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 7: NDA */}
          {step === 7 && (
            <div className="kiosk-form-step anim-slide-up" key="step-7" style={{ maxWidth: '600px' }}>
              <img src="/logo.png" alt="Easy Stones" className="kiosk-step-logo" />
              <div className="kiosk-step-indicator">Step 6 of 6</div>
              <h2 className="kiosk-step-question">Safety & NDA</h2>
              <p className="kiosk-step-hint">Please review before entry</p>

              <div className="kiosk-nda-box">
                <h4>⚠️ Warehouse Safety Policy</h4>
                <p>Easy Stones operates a working stone warehouse with heavy slab machinery. Visitors must remain within marked walkways and keep children supervised at all times.</p>
                <h4>📜 Confidentiality Agreement</h4>
                <p>Wholesale pricing schedules and inventory logs remain strictly confidential to Easy Stones.</p>
              </div>

              <label className="kiosk-nda-agree">
                <input type="checkbox" checked={ndaAccepted} onChange={(e) => setNdaAccepted(e.target.checked)} className="kiosk-nda-checkbox" />
                <span>I agree to the <strong>Safety Rules & NDA Terms</strong></span>
              </label>
            </div>
          )}

          {/* STEP 8: Success */}
          {step === 8 && (
            <div className="kiosk-success-stage anim-scale-in" key="step-8">
              <div className="kiosk-success-icon"><CheckCircle2 size={72} /></div>
              <h1 className="kiosk-success-title">Welcome, {name}!</h1>
              <p className="kiosk-success-body">Our team at <strong>Easy Stones {selectedLocation}</strong> has been notified. A sales specialist will be with you shortly.</p>
              <div className="kiosk-countdown-pill">Resetting in <strong>{resetTimer}s</strong></div>
            </div>
          )}
        </div>

        {/* ── Bottom Action Bar ── */}
        <div className="kiosk-bottom-bar">
          {step === 1 ? (
            <div className="kiosk-bottom-actions centered">
              <button type="button" className="kiosk-btn-primary" onClick={() => setStep(2)}>
                <span>Check In</span><ChevronRight size={20} />
              </button>
            </div>
          ) : step === 8 ? (
            <div className="kiosk-bottom-actions centered">
              <button type="button" className="kiosk-btn-primary" onClick={resetSelfForm}>Done</button>
            </div>
          ) : (
            <div className="kiosk-bottom-actions spread">
              <button type="button" className="kiosk-btn-secondary" onClick={handlePrevStep}>
                <ChevronLeft size={18} /><span>Back</span>
              </button>
              {step === 7 ? (
                <button type="button" className={`kiosk-btn-primary gold`} disabled={!ndaAccepted || loading} onClick={handleSelfSubmit}>
                  <span>{loading ? 'Submitting...' : 'Complete Check-In'}</span><ChevronRight size={20} />
                </button>
              ) : (
                <button type="button" className="kiosk-btn-primary" disabled={(step === 2 && !name.trim()) || (step === 3 && phone.replace(/\D/g, '').length < 10) || (step === 4 && !visitorType) || (step === 5 && !companyName.trim())} onClick={handleNextStep}>
                  <span>Next</span><ChevronRight size={20} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // RENDER 2: STAFF CHECK-IN FORM (/checkin)
  // ═══════════════════════════════════════════════════════
  return (
    <div className={`checkin-container ${theme}-theme`}>
      <div className="checkin-simple-header">
        <h1 className="checkin-title-text">Visitor Check-In</h1>
        {hasMultipleLocations ? (
          <div className="checkin-select-container">
            <select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)} className="checkin-branch-select-input">
              {allowedLocations.map(loc => (
                <option key={loc} value={loc} style={{ background: '#0f172a', color: '#ffffff' }}>📍 {loc} Office</option>
              ))}
            </select>
            <div className="checkin-select-arrow"><ChevronDown size={16} /></div>
          </div>
        ) : (
          <span className="checkin-branch-pill-badge">📍 {locationDisplay}</span>
        )}
      </div>

      <div className="checkin-card">
        {submitted ? (
          <div className="success-message">
            <CheckCircle2 size={64} className="success-icon" />
            <h2>Welcome!</h2>
            <p>Thank you for checking in!</p>
            <button type="button" className="submit-btn" onClick={() => setSubmitted(false)} style={{ marginTop: '1.5rem', width: 'auto', padding: '0.8rem 2rem' }}>
              Check In Another Visitor
            </button>
          </div>
        ) : (
          <form onSubmit={handleStaffSubmit} className="checkin-form">
            <div className="form-sections-container">
              <div className="form-section">
                <h3>Customer Information</h3>
                <div className="input-field">
                  <label><User size={16} /> Name <span className="required">*</span></label>
                  <input type="text" name="name" value={staffFormData.name} onChange={handleStaffChange} placeholder="Enter your full name" required />
                </div>
                <div className="input-field">
                  <label><Phone size={16} /> Phone Number <span className="required">*</span></label>
                  <input type="tel" name="phone" value={staffFormData.phone} onChange={handleStaffChange} placeholder="(555) 000-0000" required />
                </div>
              </div>
              <div className="form-section">
                <h3>Fabricator / Contractor Info</h3>
                <div className="input-field">
                  <label><Building size={16} /> Company/Contact Name <span className="required">*</span></label>
                  <input type="text" name="fabricatorCompany" value={staffFormData.fabricatorCompany} onChange={handleStaffChange} placeholder="Enter company/contact name" required />
                </div>
                <div className="input-field">
                  <label><Phone size={16} /> Company Phone Number <span className="required">*</span></label>
                  <input type="tel" name="fabricatorPhone" value={staffFormData.fabricatorPhone} onChange={handleStaffChange} placeholder="(555) 000-0000" required />
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
