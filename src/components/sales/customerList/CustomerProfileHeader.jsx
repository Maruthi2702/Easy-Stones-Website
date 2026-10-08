import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronDown, Phone, Mail, Navigation, FolderPlus, CalendarPlus, MapPin,
  LayoutDashboard, Info, X, Clock, Folder, Users, Share2
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { STATUSES, companyOf, cityLineOf, streetOf } from '../../../utils/customerList';
import { StatusDot, LocationTag, RepBadge, TypeTag, LevelTag } from './parts';
import SplitAction from './SplitAction';
import { peopleOf, directionsHref, telHref, profileStats } from './uiHelpers';
import './CustomerList.css';

const TABS = [
  { key: 'visits', label: 'Visits', icon: Clock, count: (c) => (c.visits || []).length },
  { key: 'resources', label: 'Resources', icon: Folder, count: (c) => (c.resources || []).length },
  { key: 'contacts', label: 'Contacts', icon: Users, count: (c) => (c.contacts || []).length },
  { key: 'network', label: 'Network', icon: Share2, count: (c) => (c.associatedCustomers || []).length }
];

/**
 * The customer profile's header: who they are, their status, the actions you
 * take from here, a summary strip and the tabs. The tab contents below it are
 * SalesPage's own (Visits / Resources / Contacts / Network).
 */
const CustomerProfileHeader = ({
  customer, activeTab, onTab, onBack, onGoHome, showInfo, onToggleInfo,
  onLogVisit, onAddResource, canEdit, onStatusChanged, loading
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const c = useMemo(() => customer || {}, [customer]);
  const stats = useMemo(() => profileStats(c), [c]);
  const people = useMemo(() => peopleOf(c, c), [c]);
  const directions = directionsHref(c);
  const address = [streetOf(c), cityLineOf(c)].filter(Boolean).join(', ');

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

  const statCells = [
    ['Last visit', stats.lastVisit], ['Visits · 12 mo', stats.visits12], ['Resources', stats.resources],
    ['Next follow-up', stats.followUp], ['Customer since', stats.since]
  ];

  return (
    <div className="cl cl-ph">
      <div className="cl-ph-top">
        <button type="button" className="cl-btn sm" onClick={onBack} title="Back to customers">
          <ArrowLeft size={16} aria-hidden="true" />Customers
        </button>
        <span className="cl-grow" />
        {onGoHome && <button type="button" className="cl-ib" onClick={onGoHome} title="Sales dashboard" aria-label="Sales dashboard"><LayoutDashboard size={18} /></button>}
        {onToggleInfo && (
          <button type="button" className={`cl-btn sm${showInfo ? ' soft' : ''}`} onClick={onToggleInfo} aria-pressed={!!showInfo}>
            {showInfo ? <X size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}{showInfo ? 'Hide details' : 'Details & notes'}
          </button>
        )}
      </div>

      <section className="cl-sec cl-ph-card" aria-label="Customer">
        <div className="cl-ph-head">
          <span className="cl-ph-mark cl-hide-phone" aria-hidden="true">{companyOf(c).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>
          <div className="cl-ph-id" style={{ flex: 1, minWidth: 0 }}>
            <h1 className="cl-ph-name">{loading && !c.company ? 'Loading…' : companyOf(c)}</h1>
            <div className="cl-dh-meta">
              <TypeTag type={c.customerType} />
              <LevelTag level={c.level || c.segment} />
              {/* Hidden on a phone so the line fits one row; it's in Details & notes. */}
              {address && <span className="cl-dh-place" title={address}><MapPin size={14} aria-hidden="true" /><span>{address}</span></span>}
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

        <div className="cl-qa" style={{ marginTop: 16 }}>
          <SplitAction icon={Phone} verb="Call" people={people} field="phone" hrefOf={telHref} />
          <SplitAction icon={Mail} verb="Email" people={people} field="email" hrefOf={(e) => `mailto:${e}`} />
          {directions && <a className="cl-btn" href={directions} target="_blank" rel="noopener noreferrer"><Navigation size={16} aria-hidden="true" />Directions</a>}
          {onAddResource && <button type="button" className="cl-btn" onClick={onAddResource}><FolderPlus size={16} aria-hidden="true" />Add resource</button>}
          {onLogVisit && <button type="button" className="cl-btn gold cl-ph-log" onClick={onLogVisit}><CalendarPlus size={16} aria-hidden="true" />Log visit</button>}
        </div>

        <div className="cl-stats">
          {statCells.map(([label, s]) => (
            <div className="cl-stat" key={label}>
              <span className="cl-muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
              <span className="v">{s.value}</span>
              {s.sub && <span className="cl-sub" style={{ margin: 0 }}>{s.sub}</span>}
            </div>
          ))}
        </div>
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
