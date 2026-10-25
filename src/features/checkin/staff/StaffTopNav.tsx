import { ChevronLeft, LogOut } from 'lucide-react';

/**
 * The staff /checkin page's own top bar: back to Sales (only for a login that
 * can open a Sales page — the Kiosk role can't) and Sign out. The page has no
 * site header (App.jsx), so this is its way back and out.
 */
export default function StaffTopNav({ showSales, onSales, onSignOut }: { showSales: boolean; onSales: () => void; onSignOut: () => void }) {
  return (
    <div className="checkin-topnav">
      {showSales ? (
        <button type="button" className="checkin-topnav-btn" onClick={onSales}>
          <ChevronLeft size={16} aria-hidden="true" /> Sales
        </button>
      ) : <span />}
      <button type="button" className="checkin-topnav-btn" onClick={onSignOut}>
        <LogOut size={15} aria-hidden="true" /> Sign out
      </button>
    </div>
  );
}
