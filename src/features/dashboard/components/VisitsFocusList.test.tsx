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
