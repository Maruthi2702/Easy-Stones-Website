import { useEffect } from 'react';
import { companyOf, contactOf, realEmailsOf, streetOf, cityLineOf } from '../../../utils/customerList';

export const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

/** Google Maps directions to the stored point, else to the address text. */
export const directionsHref = (c = {}) => {
  const lat = c.coordinates?.lat;
  const lng = c.coordinates?.lng;
  const dest = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat},${lng}`
    : [streetOf(c), cityLineOf(c)].filter(Boolean).join(', ');
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : '';
};

/** Everyone you can call or email at a customer: the record's own contact, extra addresses, then the contacts list. */
export const peopleOf = (c = {}, detail) => {
  const emails = realEmailsOf(c);
  const people = [{
    key: 'primary',
    name: contactOf(c) || companyOf(c),
    role: 'Primary',
    phone: c.phone || '',
    email: emails[0] || ''
  }];
  emails.slice(1).forEach((email, i) => people.push({ key: `e${i}`, name: '', role: 'Other email', phone: '', email }));
  (detail?.contacts || []).forEach((ct, i) => people.push({
    key: ct._id || `c${i}`,
    name: ct.name || '',
    role: ct.role || 'Contact',
    phone: ct.phone || '',
    email: ct.email || ''
  }));
  return people;
};

const DAY = 24 * 60 * 60 * 1000;
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const dateOnly = (v) => (typeof v === 'string' ? v.slice(0, 10) : (v ? localDay(new Date(v)) : ''));
const shortDay = (d) => {
  if (!d) return '';
  const date = new Date(`${d}T12:00:00`);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / DAY);
const relDays = (n) => {
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n === -1) return 'tomorrow';
  return n > 0 ? `${n} days ago` : `in ${-n} days`;
};

/** The summary strip on a customer's profile, from what the record already holds. */
export const profileStats = (c = {}, now = new Date()) => {
  const t = localDay(now);
  const visits = (c.visits || []).map(v => ({ ...v, day: dateOnly(v.date) })).filter(v => v.day);
  const past = visits.filter(v => v.day <= t).sort((a, b) => b.day.localeCompare(a.day));
  const last = dateOnly(c.lastVisitDate) || past[0]?.day || '';
  const yearAgo = localDay(new Date(now.getTime() - 365 * DAY));
  const thisMonth = t.slice(0, 7);
  const followUps = visits.map(v => dateOnly(v.followUpDate)).filter(d => d && d >= t).sort();
  const resources = c.resources || [];
  const created = c.createdAt ? new Date(c.createdAt) : null;
  return {
    lastVisit: last ? { value: shortDay(last), sub: relDays(daysBetween(last, t)) } : { value: '—', sub: 'No visits yet' },
    visits12: {
      value: String(visits.filter(v => v.day >= yearAgo && v.day <= t).length),
      sub: `${visits.filter(v => v.day.startsWith(thisMonth)).length} this month`
    },
    resources: { value: String(resources.length), sub: resources.length ? 'placed' : 'None placed' },
    followUp: followUps[0] ? { value: shortDay(followUps[0]), sub: relDays(daysBetween(followUps[0], t)) } : { value: '—', sub: 'None scheduled' },
    since: created && !Number.isNaN(created.getTime())
      ? { value: created.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), sub: created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
      : { value: '—', sub: '' }
  };
};

/** Slug for the per-location tint classes PartnersSheet.css already defines (.location-badge.seattle …). */
export const locationClass = (name) => String(name || 'Seattle').toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * Close a popover on an outside press or Escape. Not portalled anywhere — the
 * popover stays inside its trigger's container (see CLAUDE.md on CustomSelect:
 * portalling changes stacking against modals).
 */
export const useDismiss = (open, setOpen, ref, { closeOnScroll = false } = {}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    // A screen-anchored (position: fixed) menu would drift away from its button
    // when the page scrolls, so those close instead — but not when the scroll
    // is inside the menu itself.
    const onScroll = (e) => { if (!(ref.current && e.target instanceof Node && ref.current.contains(e.target))) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    if (closeOnScroll) {
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, setOpen, ref, closeOnScroll]);
};

/**
 * Where to put a menu so nothing can clip it: measured from its button and
 * pinned to the screen (position: fixed). Table cells hide overflow and the
 * table and selection bar scroll sideways, so an absolutely-positioned menu
 * inside them gets cut off. The menu stays a DOM child of its button's wrapper
 * (no portal), so stacking and click-outside behave exactly as before; it sits
 * under the site header (z-index 1100) and every modal.
 * Opens below the button, or above it when there isn't room.
 */
export const anchoredMenuStyle = (button, { align = 'left', estHeight = 260 } = {}) => {
  if (!button) return undefined;
  const r = button.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - r.bottom;
  const style = { position: 'fixed', zIndex: 1000, top: 'auto', bottom: 'auto', left: 'auto', right: 'auto' };
  if (below < estHeight + 12 && r.top > below) {
    style.bottom = `${vh - r.top + 6}px`;
    style.maxHeight = `${Math.max(160, r.top - 90)}px`;
  } else {
    style.top = `${r.bottom + 6}px`;
    style.maxHeight = `${Math.max(160, below - 18)}px`;
  }
  if (align === 'right') style.right = `${Math.max(8, vw - r.right)}px`;
  else style.left = `${Math.max(8, Math.min(r.left, vw - 320))}px`;
  return style;
};

export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari / insecure context: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
};
