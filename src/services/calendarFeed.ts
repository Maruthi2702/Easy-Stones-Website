import { createHmac, timingSafeEqual } from 'node:crypto';

export function calendarFeedToken(userId: string, key: string, secret: string) {
  return createHmac('sha256', secret).update(`calendar-feed:${userId}:${key}`).digest('hex');
}

export function validCalendarFeedToken(token: unknown, userId: string, key: string | null | undefined, secret: string) {
  if (!key || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(calendarFeedToken(userId, key, secret), 'hex'));
}
