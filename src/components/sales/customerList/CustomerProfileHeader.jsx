import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronDown, MapPin, LayoutDashboard, Info, Clock, Folder, Users, Share2
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { STATUSES, companyOf, cityLineOf, cityOf, streetOf } from '../../../utils/customerList';
import { StatusDot, LocationTag, RepBadge, TypeTag, LevelTag } from './parts';
import './CustomerList.css';

const TABS = [
  { key: 'visits', label: 'Visits', icon: Clock, count: (c) => (c.visits || []).length },
  { key: 'resources', label: 'Resources', icon: Folder, count: (c) => (c.resources || []).length },
  { key: 'contacts', label: 'Contacts', icon: Users, count: (c) => (c.contacts || []).length },
  { key: 'network', label: 'Network', icon: Share2, count: (c) => (c.associatedCustomers || []).length },
  // Stats, pricing & Moda, marketing, the quick note and admin account
  // (CustomerDetailsTab) — what used to crowd the header (2026-10-07).
  { key: 'details', label: 'Details', icon: Info, count: () => 0 }
];

/**
 * The customer profile's header: who they are (name, type, level, address,
 * branch, rep) and their status, then the tabs. Everything else — stats,
 * pricing, marketing, the quick note, admin account — is in the Details tab;
 * adding a visit, resource or contact is in the tab it belongs to. The tab
 * contents are SalesPage's own.
 */
const CustomerProfileHeader = ({
  customer, activeTab, onTab, onBack, onGoHome, canEdit, onStatusChanged, loading
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const c = useMemo(() => customer || {}, [customer]);
  const address = [streetOf(c), cityLineOf(c)].filter(Boolean).join(', ');
  const cityState = [cityOf(c), c.address?.state].filter(Boolean).join(', ');

  const changeStatus = async (next) => {
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

  return (
    <div className="cl cl-ph">
      <div className="cl-ph-top">
        <button type="button" className="cl-btn sm" onClick={onBack} title="Back to customers">
          <ArrowLeft size={16} aria-hidden="true" />Customers
        </button>
        <span className="cl-grow" />
        {onGoHome && <button type="button" className="cl-ib" onClick={onGoHome} title="Sales dashboard" aria-label="Sales dashboard"><LayoutDashboard size={18} /></button>}
      </div>

      <section className="cl-sec cl-ph-card" aria-label="Customer">
        <div className="cl-ph-head">
          <span className="cl-ph-mark cl-hide-phone" aria-hidden="true">{companyOf(c).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>
          <div className="cl-ph-id" style={{ flex: 1, minWidth: 0 }}>
            <h1 className="cl-ph-name">{loading && !c.company ? 'Loading…' : companyOf(c)}</h1>
            <div className="cl-dh-meta">
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
        {error && <div className="cl-err" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      </section>

      <div className="cl-tabs" role="tablist" aria-label="Customer sections" style={{ marginTop: 14 }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const n = t.count(c);
          return (
            <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key} className="cl-tab" onClick={() => onTab(t.key)}>
              <Icon size={15} aria-hidden="true" />{t.label}{n > 0 && <span className="n">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CustomerProfileHeader;
