import { describe, it, expect } from 'vitest';
import { isStaffWrite, staffWritesPaused } from './staffWritesPause.ts';

describe('staff pause', () => {
  it('is on only for the word true', () => {
    expect(staffWritesPaused({ STAFF_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(staffWritesPaused({} as never)).toBe(false);
    expect(staffWritesPaused({ STAFF_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops every save of a user, role, location, password or own setting', () => {
    for (const [m, p] of [
      ['POST', '/api/admin/users'], ['PUT', '/api/admin/users/abc'], ['PATCH', '/api/admin/users/abc/active'], ['POST', '/api/admin/users/abc/unlock'],
      ['DELETE', '/api/admin/roles/abc'], ['PATCH', '/api/admin/locations/abc'], ['POST', '/api/auth/first-password'],
      ['POST', '/api/auth/accept-invite'], ['POST', '/api/auth/change-password'], ['PUT', '/api/user/me/pinned-tabs'],
      ['PUT', '/api/user/me/route-planner-filters'], ['POST', '/api/auth/google/calendar/disconnect'], ['POST', '/api/calendar/subscription/rotate'],
      ['PUT', '/api/delivery-columns/Seattle?x=1']
    ] as const) expect(isStaffWrite(m, p), `${m} ${p}`).toBe(true);
  });
  it('lets reads, signing in and other areas through', () => {
    for (const [m, p] of [
      ['GET', '/api/admin/users'], ['GET', '/api/admin/locations'], ['POST', '/api/auth/login'], ['POST', '/api/customer/login'],
      ['POST', '/api/customers'], ['PUT', '/api/nav-order'], ['GET', '/api/user/me/pinned-tabs']
    ] as const) expect(isStaffWrite(m, p), `${m} ${p}`).toBe(false);
  });
});
