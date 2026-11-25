// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CardsPanel from './CardsPanel';

vi.mock('../cardReceiptsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cardReceiptsApi')>()),
  listCards: async () => ({
    cards: [
      { _id: 'c1', userId: 'u1', label: 'ABHI92001', issuer: 'amex', lastDigits: '92001', active: true, amexName: 'ABHINAV C MEDURI', location: '' },
      { _id: 'c2', userId: 'u1', label: 'ABHI9902', issuer: 'encore', lastDigits: '9902', active: true, amexName: 'ABHINAV MEDURI', location: '' },
      { _id: 'c3', userId: 'u2', label: 'SURY93001', issuer: 'amex', lastDigits: '93001', active: true, amexName: '', location: '' }
    ],
    people: [
      { id: 'u1', name: 'Abhinav Meduri', role: 'sales_rep', location: 'Atlanta', active: true },
      { id: 'u2', name: 'Surya Somepalli', role: 'sales_rep', location: 'Atlanta', active: true }
    ]
  })
}));

describe('Company cards', () => {
  it('shows a person’s Amex and Encore cards together in one row', async () => {
    render(<CardsPanel canManage={false} onSaved={() => {}} />);
    const holder = await screen.findByText('Abhinav Meduri');
    const row = holder.closest('tr')!;
    expect(within(row).getByText('ABHI92001')).toBeTruthy();
    expect(within(row).getByText('ABHI9902')).toBeTruthy();
    expect(row.textContent).toMatch(/Encore ···9902/);
    expect(screen.getAllByText('Abhinav Meduri')).toHaveLength(1);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + two people
  });
});
