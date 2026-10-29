import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown, MapPin, Info, Clock, Folder, Users, Share2, MoreHorizontal, X, Pencil, Trash2, Phone, Navigation, Plus, Check
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { STATUSES, companyOf, cityLineOf, cityOf, streetOf } from '../../../utils/customerList';
import { StatusDot, LocationTag, RepBadge, TypeTag, LevelTag } from './parts';
import { useDismiss } from './uiHelpers';
import { planHeaderMenu, telHref, directionsHref } from '../profile/profileHeaderRules';
import MenuLayer from '../profile/MenuLayer';
import { isSheetScreen, useSheetEscape } from '../profile/sheetScreen';
import type { Loose } from '../../../types/records';
import './CustomerList.css';
import '../profile/CustomerProfile.css';

const TABS = [
  { key: 'visits', label: 'Visits', icon: Clock, count: (c: Loose) => (c.visits || []).length },
  { key: 'resources', label: 'Resources', icon: Folder, count: (c: Loose) => (c.resources || []).length },
  { key: 'contacts', label: 'Contacts', icon: Users, count: (c: Loose) => (c.contacts || []).length },
  { key: 'network', label: 'Network', icon: Share2, count: (c: Loose) => (c.associatedCustomers || []).length },
  // Stats, pricing & Moda, marketing, the quick note and admin account
  // (CustomerDetailsTab) — what used to crowd the header (2026-10-07).
  { key: 'details', label: 'Details', icon: Info, count: () => 0 }
];

/**
 * The customer profile's header (redesign 2026-10-29, "Customer profile header
 * redesign" canvas): who they are (name, type, level, address, branch, rep),
 * their status, a ⋯ menu and a ✕ that goes back to the list — then the tabs
 * with the active tab's one Add button. Everything else — stats, pricing,
 * marketing, the quick note, admin account — is in the Details tab. The tab
 * contents are the profile's own.
 *
 * The ⋯ menu holds Edit / Delete customer for logins that have them; up to
 * 700px the status picker moves into it, and on a phone so do Call and
 * Directions (profileHeaderRules.ts). Tabs are icons with counts on a phone,
 * and the Add button is the round + there.
 */
export type CustomerProfileHeaderProps = {
  customer: Loose | null;
  activeTab: string;
  onTab: (tab: string) => void;
  /** ✕: back to the Customers list. */
  onBack: () => void;
  /** Can this login change the customer's status? */
  canEdit: boolean;
  canEditCustomer?: boolean;
  canDeleteCustomer?: boolean;
  onEditCustomer?: () => void;
  onDeleteCustomer?: () => void;
  onStatusChanged?: (status: string) => void;
  loading?: boolean;
  /** The active tab's Add button; null when the tab has none (Details) or its empty card holds it. */
  action?: { label: string; onClick: () => void } | null;
};

const CustomerProfileHeader = ({
  customer, activeTab, onTab, onBack, canEdit, canEditCustomer = false, canDeleteCustomer = false,
  onEditCustomer, onDeleteCustomer, onStatusChanged, loading, action
}: CustomerProfileHeaderProps) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = () => { setMenuOpen(false); setStatusOpen(false); };
  useDismiss(menuOpen && !sheet, (open: boolean) => { if (!open) closeMenu(); }, menuRef);
  useSheetEscape(menuOpen, sheet, closeMenu);

  const c: Loose = useMemo(() => customer || {}, [customer]);
  const address = [streetOf(c), cityLineOf(c)].filter(Boolean).join(', ');
  const cityState = [cityOf(c), c.address?.state].filter(Boolean).join(', ');
  const plan = planHeaderMenu({
    canEditCustomer, canDeleteCustomer, canChangeStatus: canEdit, hasPhone: Boolean(c.phone), hasAddress: Boolean(address)
  });

  const changeStatus = async (next: string) => {
    if (!next || next === c.status || !c._id) return;
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/api/customers/${c._id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
      if (!res.ok) throw new Error();
      onStatusChanged?.(next);
      window.dispatchEvent(new CustomEvent('customers:changed'));
    } catch {
      setError('Could not change the status. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = TABS.findIndex(t => t.key === activeTab);
    const next = (at + step + TABS.length) % TABS.length;
    onTab(TABS[next].key);
    const buttons = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
    buttons[next]?.focus();
  };

  return (
    <div className="cl cl-ph cp">
      <section className="cl-sec cl-ph-card cp-card" aria-label="Customer">
        <div className="cp-head">
          <span className="cl-ph-mark cl-hide-phone" aria-hidden="true">{companyOf(c).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>
          <div className="cp-id">
            <h1 className="cl-ph-name cp-name">{loading && !c.company ? 'Loading…' : companyOf(c)}</h1>
            <div className="cl-dh-meta cp-meta">
              <TypeTag type={c.customerType} />
              <LevelTag level={c.level || c.segment} />
              {/* Full address on a laptop, city and state on an iPad, none on a
                  phone — so the line stays one row (CustomerList.css). */}
              {address && (
                <span className="cl-dh-place" title={address}>
                  <MapPin size={14} aria-hidden="true" />
                  <span className="cl-place-full">{address}</span>
                  <span className="cl-place-short">{cityState || address}</span>
                </span>
              )}
              <LocationTag customer={c} />
              <RepBadge name={c.salesRepName} />
            </div>
          </div>

          <div className="cp-tools">
            {/* Gone at 700px and below, where it moves into the ⋯ menu. */}
            <div className="cp-status">
              {canEdit ? (
                <label className="cl-pill" title="Change status" style={{ position: 'relative' }}>
                  <StatusDot status={c.status} />
                  <select value={c.status || ''} disabled={saving} onChange={(e) => changeStatus(e.target.value)} aria-label="Status" style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', cursor: 'pointer' }}>
                    {!c.status && <option value="">No status</option>}
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
              ) : <StatusDot status={c.status} />}
            </div>

            {plan.button !== 'none' && (
              <div className="cp-more-wrap" ref={menuRef}>
                <button
                  type="button" className={`cp-more cp-more--${plan.button}`} aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen}
                  onClick={() => { setSheet(isSheetScreen()); setMenuOpen(o => !o); setStatusOpen(false); }}
                >
                  <MoreHorizontal size={20} aria-hidden="true" />
                </button>
                {menuOpen && (
                  <MenuLayer sheet={sheet}>
                    <div className="cp-scrim" onClick={closeMenu} aria-hidden="true" />
                    <div className="cp-menu" role="menu" aria-label="Customer actions">
                      <div className="cp-sheet-h" aria-hidden="true" />
                      {plan.call && (
                        <a className="cp-mi cp-only-ph" role="menuitem" href={telHref(c.phone)} onClick={closeMenu}><Phone size={18} aria-hidden="true" />Call {c.contactName || 'customer'}</a>
                      )}
                      {plan.directions && (
                        <a className="cp-mi cp-only-ph" role="menuitem" href={directionsHref(address)} target="_blank" rel="noopener noreferrer" onClick={closeMenu}><Navigation size={18} aria-hidden="true" />Directions</a>
                      )}
                      {(plan.call || plan.directions) && <div className="cp-sep cp-only-ph" role="separator" />}
                      {plan.status && (
                        <>
                          <button type="button" className="cp-mi cp-only-sm" role="menuitem" aria-expanded={statusOpen} onClick={() => setStatusOpen(o => !o)}>
                            <StatusDot status={c.status} />
                            <span className="cp-mi-end"><ChevronDown size={16} aria-hidden="true" /></span>
                          </button>
                          {statusOpen && (
                            <div className="cp-stlist cp-only-sm" role="group" aria-label="Change status">
                              {STATUSES.map(s => (
                                <button key={s} type="button" className="cp-mi cp-sub" role="menuitemradio" aria-checked={c.status === s} disabled={saving} onClick={() => { closeMenu(); changeStatus(s); }}>
                                  <span className="cp-tick">{c.status === s ? <Check size={14} aria-hidden="true" /> : null}</span>{s}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="cp-sep cp-only-sm" role="separator" />
                        </>
                      )}
                      {plan.edit && (
                        <button type="button" className="cp-mi" role="menuitem" onClick={() => { closeMenu(); onEditCustomer?.(); }}>
                          <Pencil size={18} aria-hidden="true" />Edit customer
                        </button>
                      )}
                      {plan.edit && plan.delete && <div className="cp-sep" role="separator" />}
                      {plan.delete && (
                        <button type="button" className="cp-mi danger" role="menuitem" onClick={() => { closeMenu(); onDeleteCustomer?.(); }}>
                          <Trash2 size={18} aria-hidden="true" />Delete customer…
                        </button>
                      )}
                    </div>
                  </MenuLayer>
                )}
              </div>
            )}

            <button type="button" className="cp-close" onClick={onBack} aria-label="Close and back to customers" title="Back to customers">
              <X size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </div>
        {error && <div className="cl-err" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      </section>

      <div className="cp-bar">
        <div className="cp-tabs" role="tablist" aria-label="Customer sections" onKeyDown={onTabKey}>
          {TABS.map(t => {
            const Icon = t.icon;
            const n = t.count(c);
            return (
              <button key={t.key} type="button" role="tab" aria-label={t.label} aria-selected={activeTab === t.key} className="cp-tab" onClick={() => onTab(t.key)}>
                <Icon size={16} aria-hidden="true" /><span className="cp-tab-lab">{t.label}</span>{n > 0 && <span className="n">{n}</span>}
              </button>
            );
          })}
        </div>
        {action && (
          <>
            <button type="button" className="cl-btn gold cp-act" aria-label={action.label} onClick={action.onClick}>
              <Plus size={18} aria-hidden="true" /><span className="cp-act-full">{action.label}</span><span className="cp-act-short">Add</span>
            </button>
            <button type="button" className="cp-fab" aria-label={action.label} onClick={action.onClick}><Plus size={26} strokeWidth={2.4} aria-hidden="true" /></button>
          </>
        )}
      </div>
    </div>
  );
};

export default CustomerProfileHeader;
