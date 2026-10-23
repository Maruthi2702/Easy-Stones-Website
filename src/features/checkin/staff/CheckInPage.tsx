import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { useAuth } from '../../../context/AuthContext';
import { homeLocationOf } from '../../../utils/locationFilter';
import SelfCheckInKiosk from './SelfCheckInKiosk';
import StaffCheckInForm from './StaffCheckInForm';
import './CheckInPage.css';

/**
 * Visitor check-in: the staff form (/checkin) or, from a QR code / NFC tag,
 * the visitor's own kiosk (/self-checkin, or ?mode=self|qr|nfc). This keeps
 * what both share — who is signed in, the theme, the branch — and hands the
 * screen to SelfCheckInKiosk or StaffCheckInForm.
 */
const CheckInPage = ({ isSelfCheckIn = false }: { isSelfCheckIn?: boolean }) => {
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => { await logout(); navigate('/login'); };

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

  // Until the real list loads: the branches they're assigned, so the picker
  // never briefly offers only Seattle/Spokane/SLC to someone based elsewhere.
  const [availableLocations, setAvailableLocations] = useState(() => {
    const assigned = (user?.assignedLocations || []).filter(l => l !== '*');
    return assigned.length ? assigned : ['Seattle', 'Spokane', 'Salt Lake City'];
  });
  
  const urlLocationParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('location') : null;
  const isLockedLocation = isSelf || Boolean(urlLocationParam);
  const hasMultipleLocations = !isLockedLocation && (user && (user.assignedLocations?.includes('*') || (user.assignedLocations?.length ?? 0) > 1));
  
  const allowedLocations = (user?.assignedLocations?.includes('*') || isSelf)
    ? availableLocations
    : availableLocations.filter(loc => user?.assignedLocations?.includes(loc));

  // The link's ?location=, else their home location (Users & Roles) — the
  // same default the server files under. It used to be their first assigned
  // branch, so a CSR based in Dallas who also covers Seattle opened on Seattle.
  const [selectedLocation, setSelectedLocation] = useState(() => {
    if (urlLocationParam) return urlLocationParam;
    return homeLocationOf(user) || user?.assignedLocations?.find(l => l !== '*') || 'Seattle';
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

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const res = await authFetch(`${API_URL}/api/admin/locations`);
        if (res.ok) {
          const data = await res.json();
          if (data?.length > 0) {
            setAvailableLocations(data.map((l: { name: string }) => l.name));
            const urlLoc = new URLSearchParams(window.location.search).get('location');
            if (urlLoc) setSelectedLocation(urlLoc);
          }
        }
      } catch { /* not fatal — carry on */ }
    };
    loadLocations();
  }, [user, isSelf]);

  // Wakes a cold server before the first check-in. The health check, not the
  // staff list: a Kiosk login may not read that (requireSalesPage).
  useEffect(() => { fetch(`${API_URL}/api/health`).catch(() => {}); }, []);

  if (!user && !isSelf) return null;

  // A kiosk QR code/URL with no ?location= has no way to know which branch
  // it's sitting in — silently defaulting to Seattle mis-logs every visit
  // instead of failing loudly (see CLAUDE.md incident history). Refuse to
  // check anyone in until whoever set up the kiosk fixes the URL.
  if (isSelf && !urlLocationParam) {
    return (
      <div className={`kiosk-fullscreen ${theme}-theme`}>
        <div className="kiosk-center-stage">
          <div className="kiosk-success-stage anim-scale-in">
            <div className="kiosk-success-icon"><AlertTriangle size={72} /></div>
            <h1 className="kiosk-success-title">Kiosk Setup Required</h1>
            <p className="kiosk-success-body">
              This check-in link is missing its branch location. Ask a manager to
              regenerate the QR code/URL with the correct <code>?location=</code> parameter
              before using this kiosk.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const locationDisplay = selectedLocation.includes('Showroom') || selectedLocation.includes('Branch') || selectedLocation.includes('Office')
    ? selectedLocation : `${selectedLocation} Showroom`;

  // ═══════════════════════════════════════════════════════
  // RENDER 1: SELF CHECK-IN KIOSK (Full-Screen)
  // ═══════════════════════════════════════════════════════
  if (isSelf) {
    return <SelfCheckInKiosk theme={theme} selectedLocation={selectedLocation} locationDisplay={locationDisplay} />;
  }

  // ═══════════════════════════════════════════════════════
  // RENDER 2: STAFF CHECK-IN FORM (/checkin)
  // ═══════════════════════════════════════════════════════
  return (
    <StaffCheckInForm
      theme={theme}
      user={user!}
      selectedLocation={selectedLocation}
      setSelectedLocation={setSelectedLocation}
      hasMultipleLocations={Boolean(hasMultipleLocations)}
      allowedLocations={allowedLocations}
      locationDisplay={locationDisplay}
      onSales={() => navigate('/sales')}
      onSignOut={handleSignOut}
    />
  );
};

export default CheckInPage;