// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import VisitsFocusList from './VisitsFocusList';
vi.mock('../../../api/authFetch', () => ({ authFetch: vi.fn() }));
afterEach(cleanup);
it('shows a date-only visit on its stored calendar day, including in Pacific time', () => {
  render(<VisitsFocusList visits={[{ _id: 'v1', date: '2026-10-31', customerName: 'Example' }]} />);
  expect(screen.getByText('OCT')).toBeTruthy(); expect(screen.getByText('31')).toBeTruthy();
});
// The open row shows what the visit says beyond its note — the manager / HQ
// comments included (owner, 2026-11-05: they were only in the View pop-up).
it('shows outcome, follow up and both comments under the note of the open visit', () => {
  render(<VisitsFocusList visits={[{ _id: 'v1', customerId: 'c1', customer: 'Solid Stone LLC', date: '2026-11-05', purpose: 'Sales Visit', notes: 'Walked the showroom', outcome: 'Liked two colours', followUp: 'Send prices', managerComment: 'Will remove from SPS', headquartersComment: 'Removed' }]} />);
  const text = document.querySelector('.dfx-details')?.textContent || '';
  expect(text).toContain('OutcomeLiked two colours');
  expect(text).toContain('Follow upSend prices');
  expect(text).toContain('Manager commentWill remove from SPS');
  expect(text).toContain('HQ commentRemoved');
});
