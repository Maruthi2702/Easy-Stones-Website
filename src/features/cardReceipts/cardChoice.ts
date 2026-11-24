import type { Card } from './types';

const key = (userId: string) => `ccr-last-card:${userId}`;

/**
 * Which card Add receipt opens on: the one this person chose last time on this device, if they still
 * hold it, else their first (Amex first, as the server orders them).
 */
export function lastCardFor(userId: string, cards: readonly Card[]): string {
  let saved = '';
  try { saved = localStorage.getItem(key(userId)) || ''; } catch { /* private window: fall through */ }
  return cards.find((c) => c._id === saved)?._id || cards[0]?._id || '';
}

export function rememberCard(userId: string, cardId: string) {
  try { localStorage.setItem(key(userId), cardId); } catch { /* nothing to remember */ }
}

/** "Amex" / "Encore": the bank's name for the toggle. */
export const bankName = (issuer: string) => (issuer === 'encore' ? 'Encore' : issuer === 'amex' ? 'Amex' : 'Card');
