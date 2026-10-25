import React, { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronRight, ChevronLeft, Home, Hammer, Palette, HardHat, Wrench, Store
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { formatPhoneInput } from '../../../utils/phoneUtils';

const VISITOR_TYPES = [
  { id: 'Homeowner', label: 'Homeowner', icon: Home, desc: 'Selecting stone for your home' },
  { id: 'Fabricator', label: 'Fabricator', icon: Hammer, desc: 'Countertop fabrication partner' },
  { id: 'Designer', label: 'Designer', icon: Palette, desc: 'Interior designer or architect' },
  { id: 'Contractor', label: 'Contractor', icon: HardHat, desc: 'General contractor or remodeler' },
  { id: 'Builder', label: 'Builder', icon: Wrench, desc: 'Custom home builder or developer' },
  { id: 'Dealer', label: 'Dealer', icon: Store, desc: 'Retail stone or tile dealer' }
];

const formatTitleCaseInput = (value: string): string => {
  if (!value) return '';
  return value.replace(/\b([a-zA-Z])([a-zA-Z]*)/g, (match: string, firstLetter: string, rest: string) => {
    return firstLetter.toUpperCase() + rest;
  });
};

/**
 * The visitor's own check-in (/self-checkin, from a QR code or NFC tag at the
 * front desk): one question per screen, then a welcome that resets itself for
 * the next visitor. Sent to the open /api/checkin/self route — the visitor's
 * phone has no session.
 */
export type SelfCheckInKioskProps = {
  theme: string;
  /** The branch from the link's ?location= (the page refuses to open without one). */
  selectedLocation: string;
  /** "Seattle Showroom" — the branch as the top bar names it. */
  locationDisplay: string;
};

export default function SelfCheckInKiosk({ theme, selectedLocation, locationDisplay }: SelfCheckInKioskProps) {
  const [honeypot, setHoneypot] = useState('');
  const [formLoadTime] = useState(Date.now());
  const [step, setStep] = useState(1);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [fabricatorPhone, setFabricatorPhone] = useState('');
  const [preferredFabricators, setPreferredFabricators] = useState('');
  const [ndaAccepted, setNdaAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-reset for success
  const [resetTimer, setResetTimer] = useState(6);
  useEffect(() => {
    // This screen is always the kiosk, so only the step matters (it was `isSelf && step === 8`).
    let interval: ReturnType<typeof setInterval> | null = null;
    if (step === 8) {
      setResetTimer(6);
      interval = setInterval(() => {
        setResetTimer(prev => {
          if (prev <= 1) { clearInterval(interval!); resetSelfForm(); return 6; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
    // resetSelfForm only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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

  const handleSelfSubmit = async (e?: { preventDefault: () => void }) => {
    if (e) e.preventDefault();
    if (honeypot) { setStep(8); return; }
    if (Date.now() - formLoadTime < 1200) { setError('Please take a moment before submitting.'); return; }
    if (!ndaAccepted) { setError('Please accept the Safety Rules & NDA terms.'); return; }

    setLoading(true); setError(null);
    const finalFabCompany = companyName.trim();
    let finalFabPhone = fabricatorPhone.trim();

    if (['Designer', 'Contractor', 'Builder', 'Dealer'].includes(visitorType)) {
      if (preferredFabricators.trim()) {
        finalFabPhone = `Preferred: ${preferredFabricators.trim()}${fabricatorPhone ? ` | ${fabricatorPhone}` : ''}`;
      }
    }

    try {
      // A dedicated, unauthenticated endpoint — this device is a visitor's own
      // phone with no session, so the general /api/checkin route (staff/kiosk,
      // requires login) 401s every time. honeypot/formLoadTime are re-checked
      // server-side too, since anyone can bypass the client-side checks above
      // by posting to the API directly.
      const response = await fetch(`${API_URL}/api/checkin/self`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(),
          fabricatorCompany: finalFabCompany || `${visitorType} Visit`,
          fabricatorPhone: finalFabPhone || 'N/A',
          location: selectedLocation,
          visitorType, isSelfCheckIn: true,
          honeypot, formLoadTime
        })
      });
      if (response.ok) { setStep(8); }
      else { const data = await response.json(); setError(data.error || data.message || 'Check-in failed. Please try again.'); }
    } catch { setError('Network error. Please check your connection.'); }
    finally { setLoading(false); }
  };

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
