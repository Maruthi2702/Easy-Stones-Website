import React, { useEffect, useRef, useState } from 'react';
import {
  User, Phone, Building, CheckCircle2, Send, Loader2, AlertTriangle, UserCheck, RotateCcw
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { formatPhoneInput } from '../../../utils/phoneUtils';
import { formatTitleCase } from '../../../utils/textUtils';
import { canCheckIn } from '../../../utils/checkInAccess.ts';
import { hasSalesPage } from '../../../utils/navPins.ts';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import type { AuthUser } from '../../../context/AuthContext';
import StaffTopNav from './StaffTopNav';

/**
 * The staff check-in form (/checkin): the visitor's name and phone, their
 * fabricator or contractor, and the branch. A phone number that checked in
 * before fills the rest in (GET /api/checkin/lookup). What's typed is kept as
 * a draft in this browser until it's sent or cleared.
 */
export type StaffCheckInFormProps = {
  theme: string;
  user: AuthUser;
  selectedLocation: string;
  setSelectedLocation: (location: string) => void;
  /** Whether this login may pick the branch (more than one, and no ?location=). */
  hasMultipleLocations: boolean;
  allowedLocations: string[];
  locationDisplay: string;
  onSales: () => void;
  onSignOut: () => void;
};

type StaffForm = { name: string; phone: string; fabricatorCompany: string; fabricatorPhone: string };

export default function StaffCheckInForm({
  theme, user, selectedLocation, setSelectedLocation, hasMultipleLocations, allowedLocations, locationDisplay, onSales, onSignOut
}: StaffCheckInFormProps) {
  const [staffFormData, setStaffFormData] = useState<StaffForm>(() => {
    try {
      const saved = localStorage.getItem('checkin_draft');
      return saved ? JSON.parse(saved) : { name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' };
    } catch {
      return { name: '', phone: '', fabricatorCompany: '', fabricatorPhone: '' };
    }
  });

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCustomerName, setSubmittedCustomerName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Staff form only: whoever checked in on this phone before, so the front
  // desk doesn't retype a returning visitor's info. 'found' drives the
  // welcome-back note; the fields themselves stay plain and editable either
  // way — this only ever pre-fills them.
  const [lookupStatus, setLookupStatus] = useState<'checking' | 'found' | null>(null);
  const [lookupVisit, setLookupVisit] = useState<{ location?: string; date?: string } | null>(null);
  const lookedUpPhoneRef = useRef('');

  // Enter advances field-to-field instead of submitting early — without this,
  // the browser's default "Enter submits the form" fires the moment someone
  // hits Enter after typing just their name, and they see a validation error
  // for fields they hadn't gotten to yet.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);
  const companyPhoneInputRef = useRef<HTMLInputElement>(null);
  const focusOnEnter = (ref: React.RefObject<HTMLInputElement | null>) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    ref.current?.focus();
  };

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (submitted) {
      timer = setTimeout(() => {
        setSubmitted(false);
      }, 10000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [submitted]);

  const handleStaffChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const v = (name === 'phone' || name === 'fabricatorPhone')
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
    setStaffFormData((prev) => {
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

      setStaffFormData((prev) => {
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

  const handleStaffSubmit = async (e: React.FormEvent) => {
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

  // Users & Roles → Check In → "Check in" (checkInAccess.js). Without it the
  // save is refused, so say so up front rather than after the form is filled.
  if (!canCheckIn(user)) {
    return (
      <div className={`checkin-container ${theme}-theme`}>
        {/* No site header here (App.jsx), so the way back and out is its own. A
            check-in-only login (the Kiosk role) has no Sales to go back to. */}
        <StaffTopNav showSales={hasSalesPage(user)} onSales={onSales} onSignOut={onSignOut} />
        <div className="checkin-simple-header">
          <h1 className="checkin-title-text">Visitor Check-In</h1>
        </div>
        <div className="checkin-card">
          <div className="success-message">
            <AlertTriangle size={64} className="success-icon checkin-no-access-icon" />
            <h2>You can’t check visitors in</h2>
            <p>Ask an admin to turn on Check In → “Check in” for your role under Users &amp; Roles.</p>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // RENDER 2: STAFF CHECK-IN FORM (/checkin)
  // ═══════════════════════════════════════════════════════
  return (
    <div className={`checkin-container ${theme}-theme`}>
      {/* No site header here (App.jsx), so the way back and out is its own. A
          check-in-only login (the Kiosk role) has no Sales to go back to. */}
      <StaffTopNav showSales={hasSalesPage(user)} onSales={onSales} onSignOut={onSignOut} />
      <div className="checkin-simple-header">
        <h1 className="checkin-title-text">Visitor Check-In</h1>
        {hasMultipleLocations ? (
          <LocationPicker
            id="checkin-branch"
            className="checkin-loc-picker"
            value={selectedLocation}
            onChange={setSelectedLocation}
            options={allowedLocations}
            user={user}
            sheetTitle="Branch"
          />
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
}
