import React, { useState, useEffect, useRef } from 'react';
import { 
  User, Phone, Building, CheckCircle2, ShieldCheck,
  Sun, Moon, ChevronRight, ChevronLeft, Home, Hammer, Palette, HardHat, Wrench, Store,
  Send, Loader2, AlertTriangle, ChevronDown, UserCheck, RotateCcw
} from 'lucide-react';
import { API_URL } from '../config/api';
import { authFetch } from '../api/authFetch';
import { formatPhoneInput } from '../utils/phoneUtils';
import { formatTitleCase } from '../utils/textUtils';
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

const formatTitleCaseInput = (value) => {
  if (!value) return '';
  return value.replace(/\b([a-zA-Z])([a-zA-Z]*)/g, (match, firstLetter, rest) => {
    return firstLetter.toUpperCase() + rest;
  });
};

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
    } catch {
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
    } catch {
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
  const [submittedCustomerName, setSubmittedCustomerName] = useState('');
  const [error, setError] = useState(null);

  // Staff form only: whoever checked in on this phone before, so the front
  // desk doesn't retype a returning visitor's info. 'found' drives the
  // welcome-back note; the fields themselves stay plain and editable either
  // way — this only ever pre-fills them.
  const [lookupStatus, setLookupStatus] = useState(null); // null | 'checking' | 'found'
  const [lookupVisit, setLookupVisit] = useState(null);   // { location, date }
  const lookedUpPhoneRef = useRef('');

  // Enter advances field-to-field instead of submitting early — without this,
  // the browser's default "Enter submits the form" fires the moment someone
  // hits Enter after typing just their name, and they see a validation error
  // for fields they hadn't gotten to yet.
  const nameInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const companyInputRef = useRef(null);
  const companyPhoneInputRef = useRef(null);
  const focusOnEnter = (ref) => (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    ref.current?.focus();
  };

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
    } catch { /* not fatal — carry on */ }
    if (user?.assignedLocations) {
      const primaryLoc = user.assignedLocations.find(l => l !== '*');
      if (primaryLoc) return primaryLoc;
    }
    return 'Seattle';
  });

  

  useEffect(() => {
    const sync = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setTheme(saved === 'dark' ? 'dark' : 'light');
      } catch { /* not fatal — carry on */ }
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

  // The staff form sits in the normal page flow, under the site's own header,
  // and the "Check In Now" button is often below the fold — so this fires
  // scrolled partway down. Without resetting it, the success message renders
  // above the fold too, but the page stays scrolled to where the (now gone)
  // form used to be, leaving the visitor's confirmation off-screen.
  useEffect(() => {
    if (submitted) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [submitted]);

  // Auto-return to check-in form after 10 seconds on successful submission
  useEffect(() => {
    let timer;
    if (submitted) {
      timer = setTimeout(() => {
        setSubmitted(false);
      }, 10000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [submitted]);

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const res = await authFetch(`${API_URL}/api/admin/locations`);
        if (res.ok) {
          const data = await res.json();
          if (data?.length > 0) {
            setAvailableLocations(data.map(l => l.name));
            const urlLoc = new URLSearchParams(window.location.search).get('location');
            if (urlLoc) setSelectedLocation(urlLoc);
          }
        }
      } catch { /* not fatal — carry on */ }
    };
    loadLocations();
  }, [user, isSelf]);

  useEffect(() => { authFetch(`${API_URL}/api/salesreps`).catch(() => {}); }, []);

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
      const response = await authFetch(`${API_URL}/api/checkin`, {
        method: 'POST',
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
    } catch { setError('Network error. Please check your connection.'); }
    finally { setLoading(false); }
  };

  const handleStaffChange = (e) => {
    const { name, value } = e.target;
    let v = (name === 'phone' || name === 'fabricatorPhone')
      ? formatPhoneInput(value)
      : (name === 'name' || name === 'fabricatorCompany')
        ? formatTitleCase(value)
        : value;
    // The phone number changed out from under whatever was last looked up —
    // the welcome-back note would otherwise keep pointing at a stale match.
    if (name === 'phone' && v !== staffFormData.phone) {
      setLookupStatus(null);
      setLookupVisit(null);
    }
    setStaffFormData(prev => {
      const next = { ...prev, [name]: v };
      try { localStorage.setItem('checkin_draft', JSON.stringify(next)); } catch { /* not fatal — carry on */ }
      return next;
    });
  };

  /**
   * Fires when the phone field loses focus. A finished 10-digit number that
   * matches a previous visit fills in name/company/company phone — the
   * fields stay ordinary text inputs, so anything wrong about a returning
   * visitor (new name, switched fabricator) is a normal edit, not a special
   * "override" step.
   */
  const handleStaffPhoneBlur = async () => {
    const digits = staffFormData.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits === lookedUpPhoneRef.current) return;
    lookedUpPhoneRef.current = digits;

    setLookupStatus('checking');
    try {
      const res = await authFetch(`${API_URL}/api/checkin/lookup?phone=${encodeURIComponent(digits)}`);
      const data = res.ok ? await res.json() : { found: false };
      if (!data.found) { setLookupStatus(null); setLookupVisit(null); return; }

      setStaffFormData(prev => {
        const next = {
          ...prev,
          name: data.name || prev.name,
          fabricatorCompany: data.fabricatorCompany || prev.fabricatorCompany,
          fabricatorPhone: data.fabricatorPhone || prev.fabricatorPhone
        };
        try { localStorage.setItem('checkin_draft', JSON.stringify(next)); } catch { /* not fatal — carry on */ }
        return next;
      });
      setLookupVisit(data.lastVisit || null);
      setLookupStatus('found');
    } catch {
      // A failed lookup just means no autofill — the form still works as a
      // blank one, so this stays silent rather than becoming a form error.
      setLookupStatus(null);
    }
  };

  /** Wipes the form back to blank — the way out of a wrong autofill, or to
   *  start the next visitor without submitting the current one. */
  const handleClearStaffForm = () => {
    setStaffFormData({ name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' });
    setLookupStatus(null);
    setLookupVisit(null);
    lookedUpPhoneRef.current = '';
    setError(null);
    try { localStorage.removeItem('checkin_draft'); } catch { /* not fatal — carry on */ }
    nameInputRef.current?.focus();
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
      const response = await authFetch(`${API_URL}/api/checkin`, {
        method: 'POST',
        body: JSON.stringify({ ...staffFormData, location: selectedLocation, loggedBy: user?.name || user?.username || 'Staff' })
      });
      if (response.ok) {
        setSubmittedCustomerName(staffFormData.name || '');
        setSubmitted(true);
        setStaffFormData({ name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' });
        setLookupStatus(null);
        setLookupVisit(null);
        lookedUpPhoneRef.current = '';
        try { localStorage.removeItem('checkin_draft'); } catch { /* not fatal — carry on */ }
      } else { const data = await response.json(); setError(data.message || 'Check-in failed'); }
    } catch { setError('Network error. Please try again.'); }
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
          {step === 1 ? (
            <span className="kiosk-topbar-brand">Easy Stones — {locationDisplay}</span>
          ) : (
            <div className="kiosk-topbar-glacier-nav">
              <button type="button" className="kiosk-topbar-arrow-btn" onClick={handlePrevStep} title="Back">
                <ChevronLeft size={28} />
              </button>
              <img src="/logo.png" alt="Easy Stones" className="kiosk-topbar-logo-img" />
              <button 
                type="button" 
                className="kiosk-topbar-arrow-btn next" 
                onClick={step === 7 ? handleSelfSubmit : handleNextStep} 
                disabled={(step === 2 && !name.trim()) || (step === 3 && phone.replace(/\D/g, '').length < 10) || (step === 4 && !visitorType) || (step === 5 && !companyName.trim()) || (step === 7 && (!ndaAccepted || loading))}
                title="Next"
              >
                <ChevronRight size={28} />
              </button>
            </div>
          )}
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
              <div className="kiosk-step-indicator">Step 1 of 6</div>
              <div className="kiosk-glacier-field-container">
                <div className="kiosk-glacier-label">
                  <span className="kiosk-required-star">*</span> Full name
                </div>
                <input type="text" value={name} onChange={(e) => setName(formatTitleCaseInput(e.target.value))} placeholder="First and last name" className="kiosk-input-line" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && handleNextStep()} />
              </div>
            </div>
          )}

          {/* STEP 3: Phone */}
          {step === 3 && (
            <div className="kiosk-form-step anim-slide-up" key="step-3">
              <div className="kiosk-step-indicator">Step 2 of 6</div>
              <div className="kiosk-glacier-field-container">
                <div className="kiosk-glacier-label">
                  <span className="kiosk-required-star">*</span> Phone number
                </div>
                <input type="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="(555) 000-0000" className="kiosk-input-line" autoFocus onKeyDown={(e) => e.key === 'Enter' && phone.replace(/\D/g, '').length >= 10 && handleNextStep()} />
              </div>
            </div>
          )}

          {/* STEP 4: Visitor Type */}
          {step === 4 && (
            <div className="kiosk-form-step anim-slide-up" key="step-4" style={{ maxWidth: '640px' }}>
              <div className="kiosk-step-indicator">Step 3 of 6</div>
              <div className="kiosk-glacier-label" style={{ marginBottom: '1.25rem', justifyContent: 'center' }}>
                <span className="kiosk-required-star">*</span> What type of visitor are you?
              </div>
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
              <div className="kiosk-step-indicator">Step 4 of 6</div>
              <div className="kiosk-glacier-field-container">
                <div className="kiosk-glacier-label">
                  <span className="kiosk-required-star">*</span> {visitorType === 'Homeowner' ? 'Fabricator or Contractor' : visitorType === 'Fabricator' ? 'Company Name' : 'Business Name'}
                </div>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(formatTitleCaseInput(e.target.value))} placeholder={visitorType === 'Homeowner' ? 'e.g. Apex Granite / John Smith' : 'e.g. Premier Stone Works'} className="kiosk-input-line" autoFocus onKeyDown={(e) => e.key === 'Enter' && companyName.trim() && handleNextStep()} />
              </div>
            </div>
          )}

          {/* STEP 6: Phone / Partners */}
          {step === 6 && (
            <div className="kiosk-form-step anim-slide-up" key="step-6">
              <div className="kiosk-step-indicator">Step 5 of 6</div>
              <div className="kiosk-glacier-field-container">
                {['Homeowner', 'Fabricator'].includes(visitorType) ? (
                  <>
                    <div className="kiosk-glacier-label">
                      <span className="kiosk-required-star">*</span> Company Phone Number
                    </div>
                    <input type="tel" value={fabricatorPhone} onChange={(e) => setFabricatorPhone(formatPhoneInput(e.target.value))} placeholder="(555) 000-0000" className="kiosk-input-line" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleNextStep()} />
                  </>
                ) : (
                  <>
                    <div className="kiosk-glacier-label">
                      <span className="kiosk-required-star">*</span> Fabricator Partners
                    </div>
                    <input type="text" value={preferredFabricators} onChange={(e) => setPreferredFabricators(formatTitleCaseInput(e.target.value))} placeholder="e.g. Olympic Marble, NW Granite" className="kiosk-input-line" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleNextStep()} />
                    <div style={{ width: '100%', marginTop: '1.75rem' }}>
                      <div className="kiosk-glacier-label" style={{ fontSize: '1rem', opacity: 0.7 }}>Company Phone (Optional)</div>
                      <input type="tel" value={fabricatorPhone} onChange={(e) => setFabricatorPhone(formatPhoneInput(e.target.value))} placeholder="(555) 000-0000" className="kiosk-input-line" style={{ fontSize: '1.15rem' }} />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* STEP 7: NDA */}
          {step === 7 && (
            <div className="kiosk-form-step anim-slide-up" key="step-7" style={{ maxWidth: '600px' }}>
              <div className="kiosk-step-indicator">Step 6 of 6</div>
              <h2 className="kiosk-step-question"><span className="kiosk-required-star">*</span> Safety & NDA</h2>
              <p className="kiosk-step-hint">Please review before entry</p>

              <div className="kiosk-nda-box">
                <h4>⚠️ Warehouse Safety Policy</h4>
                <p>Easy Stones operates a working stone warehouse with heavy slab machinery. Visitors must remain within marked walkways and keep children supervised at all times.</p>
                <h4>📜 Confidentiality Agreement</h4>
                <p>Wholesale pricing schedules and inventory logs remain strictly confidential to Easy Stones.</p>
              </div>

              <label className="kiosk-nda-agree">
                <input type="checkbox" checked={ndaAccepted} onChange={(e) => setNdaAccepted(e.target.checked)} className="kiosk-nda-checkbox" />
                <span><span className="kiosk-required-star">*</span> I agree to the <strong>Safety Rules & NDA Terms</strong></span>
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
        {(step === 1 || step === 8) && (
          <div className="kiosk-bottom-bar">
            {step === 1 ? (
              <div className="kiosk-bottom-actions centered">
                <button type="button" className="kiosk-btn-primary" onClick={() => setStep(2)}>
                  <span>Check In</span><ChevronRight size={20} />
                </button>
              </div>
            ) : (
              <div className="kiosk-bottom-actions centered">
                <button type="button" className="kiosk-btn-primary" onClick={resetSelfForm}>Done</button>
              </div>
            )}
          </div>
        )}
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
            <h2>Welcome{submittedCustomerName ? `, ${submittedCustomerName}` : ''}!</h2>
            <p>Thank you for checking in. One of our representatives will be with you shortly!</p>
          </div>
        ) : (
          <form onSubmit={handleStaffSubmit} className="checkin-form">
            {Object.values(staffFormData).some(Boolean) && (
              <div className="checkin-form-toolbar">
                <button type="button" className="checkin-clear-btn" onClick={handleClearStaffForm}>
                  <RotateCcw size={13} /> Clear form
                </button>
              </div>
            )}
            <div className="form-sections-container">
              <div className="form-section">
                <h3><User size={16} /> Customer Information</h3>
                <div className="input-field">
                  <label>Name <span className="required">*</span></label>
                  <div className="input-with-icon">
                    <User size={16} className="input-icon" />
                    <input
                      ref={nameInputRef} type="text" name="name" value={staffFormData.name} onChange={handleStaffChange}
                      placeholder="Enter full name" required autoFocus
                      onKeyDown={focusOnEnter(phoneInputRef)}
                    />
                  </div>
                </div>
                <div className="input-field">
                  <label>Phone Number <span className="required">*</span></label>
                  <div className="input-with-icon">
                    <Phone size={16} className="input-icon" />
                    <input
                      ref={phoneInputRef} type="tel" name="phone" value={staffFormData.phone}
                      onChange={handleStaffChange} onBlur={handleStaffPhoneBlur} placeholder="(555) 000-0000" required
                      onKeyDown={focusOnEnter(companyInputRef)}
                    />
                  </div>
                </div>
                {lookupStatus === 'checking' && (
                  <p className="checkin-lookup-note anim-fade-in">
                    <Loader2 size={14} className="animate-spin" /> Checking for a previous visit…
                  </p>
                )}
                {lookupStatus === 'found' && (
                  <p className="checkin-lookup-note checkin-lookup-note--found anim-fade-in">
                    <UserCheck size={14} /> Welcome back{lookupVisit?.date ? ` — last visited ${new Date(lookupVisit.date).toLocaleDateString()}${lookupVisit.location ? ` (${lookupVisit.location})` : ''}` : ''}. Filled in below — edit anything that's changed.
                  </p>
                )}
              </div>
              <div className="form-section">
                <h3><Building size={16} /> Fabricator / Contractor Info</h3>
                <div className="input-field">
                  <label>Company/Contact Name <span className="required">*</span></label>
                  <div className="input-with-icon">
                    <Building size={16} className="input-icon" />
                    <input
                      ref={companyInputRef} type="text" name="fabricatorCompany" value={staffFormData.fabricatorCompany}
                      onChange={handleStaffChange} placeholder="Enter company/contact name" required
                      onKeyDown={focusOnEnter(companyPhoneInputRef)}
                    />
                  </div>
                </div>
                <div className="input-field">
                  <label>Company Phone Number <span className="required">*</span></label>
                  <div className="input-with-icon">
                    <Phone size={16} className="input-icon" />
                    <input
                      ref={companyPhoneInputRef} type="tel" name="fabricatorPhone" value={staffFormData.fabricatorPhone}
                      onChange={handleStaffChange} placeholder="(555) 000-0000" required
                    />
                  </div>
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
