import { formatInstantTime } from '../../../utils/dateUtils';
import { checkInMoment } from '../../../utils/checkInClock.js';
import type { Loose } from '../../../types/records';

/** How the Check-In Log shows one row: its moment on its branch's clock, initials, colours. */
// A check-in's date, time and "Today" are read on its own branch's clock
// (checkInMoment, src/utils/checkInClock.js) — the same day the list's month
// filter, the counts and the Daily Report put it on. A time from a branch in
// another zone than the viewer's carries its zone ("12:30 AM EDT").
export const momentOf = (c: Loose) => checkInMoment(c.createdAt || c.date, c.location);
export const timeLabel = (m: { time: string; zone?: string }): string => (m.zone ? `${m.time} ${m.zone}` : m.time);

export const formatLastUpdated = (d: Date | string | number | null | undefined): string =>
  d ? formatInstantTime(d, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

export const getInitials = (name: string | null | undefined): string =>
  name ? name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) : '?';

const AVATAR_COLORS = ['#d4af37', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
export const getAvatarColor = (name: string | null | undefined): string => {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++)
    hash = (name as string).charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export const getLocationBadgeStyle = (location: string | null | undefined, theme: string | null | undefined): { color: string } => {
  const loc = (location || '').toLowerCase();
  const isDark = theme === 'dark';
  
  if (loc.includes('seattle')) {
    return { color: isDark ? '#2dd4bf' : '#0f766e' };
  }
  if (loc.includes('spokane')) {
    return { color: isDark ? '#a78bfa' : '#6d28d9' };
  }
  if (loc.includes('salt lake') || loc.includes('slc') || loc.includes('lake')) {
    return { color: isDark ? '#fbbf24' : '#b45309' };
  }
  return { color: isDark ? '#94a3b8' : '#475569' };
};
