// @vitest-environment jsdom
// Dashboard → Sales Visits → Goals: the table shows what the server sent, a row opens its twelve
// months, and Set goals (only when the server says so) saves each person it changed.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const net = vi.hoisted(() => ({ answer: {} as Record<string, unknown>, calls: [] as { url: string; init?: RequestInit }[], putStatus: 200 }));
vi.mock('../../../api/authFetch', () => ({
  authFetch: (url: string, init?: RequestInit) => {
    net.calls.push({ url, init });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      const id = url.split('/api/sales-goals/')[1].split('?')[0];
      if (net.putStatus !== 200) return Promise.resolve(new Response(JSON.stringify({ message: 'You can set goals only for people on your team.' }), { status: net.putStatus }));
      const person = (net.answer.people as { id: string }[]).find((p) => p.id === id);
      return Promise.resolve(new Response(JSON.stringify({ person: { ...person, goalCents: body.months.map((m: unknown) => (m === '' || m == null ? null : Math.round(Number(String(m).replace(/[$,]/g, '')) * 100))) } })));
    }
    return Promise.resolve(new Response(JSON.stringify(net.answer)));
  }
}));

const GoalsView = (await import('./GoalsView')).default;

const goals = (k: number[]) => k.map((v) => v * 100_000);
const maria = {
  id: 'a1', name: 'Maria R', branch: 'Seattle', you: true, inactive: false,
  goalCents: goals([70, 70, 80, 85, 90, 90, 80, 85, 95, 95, 90, 70]),
  salesCents: [72.4, 78.9, 85.1, 79.6, 88.3, 91.2, 76.8, 82.5, 93.4, 89.0, 84.2, null].map((v) => (v == null ? null : Math.round(v * 100_000)))
};
const daniel = { id: 'a2', name: 'Daniel K', branch: 'Kent', you: false, inactive: false, goalCents: Array(12).fill(null), salesCents: [...Array(10).fill(null), 4_000_000, null] };
const answer = (canSet: boolean, people = [maria, daniel]) => ({
  year: 2026, years: [2026, 2025], asOf: { year: 2026, month: 11, day: 25 }, canSet, canViewTeam: canSet, people
});

beforeEach(() => { net.calls = []; net.putStatus = 200; });
afterEach(cleanup);

describe('GoalsView', () => {
  it('a rep sees their own row: sales against the goal for the month and the year, with no Set goals button', async () => {
    net.answer = answer(false, [maria]);
    render(<GoalsView />);
    await screen.findByText('Maria R (you)');
    expect(screen.getByText('Sales · Nov')).toBeTruthy();
    expect(screen.getByText('Sales · 2026')).toBeTruthy();
    expect(screen.getByText('94%')).toBeTruthy();   // November: 84.2k of 90k
    expect(screen.getAllByText('On pace')).toHaveLength(2);   // the month (94% of 83% gone) and the year (92% of 90% gone)
    expect(screen.getByText('92%')).toBeTruthy();   // the year: 921.4k of 1M
    expect(screen.queryByRole('button', { name: /set goals/i })).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('a person with no goal reads "No goal set", never a miss; the team total counts only reps with a goal', async () => {
    net.answer = answer(true);
    render(<GoalsView />);
    await screen.findByText('Daniel K');
    expect(screen.getAllByText('No goal set').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('Reps with a goal')).toBeTruthy();
  });

  it('a row opens its twelve months, with quarters, This month and the to-date total', async () => {
    net.answer = answer(false, [maria]);
    render(<GoalsView />);
    fireEvent.click(await screen.findByRole('button', { name: /show maria r’s goals by month/i }));
    const months = screen.getByRole('table', { name: /maria r’s sales and goals by month, 2026/i });
    expect(within(months).getByText('September')).toBeTruthy();
    expect(within(months).getByText('This month')).toBeTruthy();
    expect(within(months).getByText('Q4')).toBeTruthy();
    expect(within(months).getByText('To date')).toBeTruthy();
    expect(within(months).getByText('Upcoming')).toBeTruthy();   // December
    expect(within(months).getAllByText(/Goal met/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /hide maria r’s goals by month/i }));
    expect(screen.queryByRole('table', { name: /by month/i })).toBeNull();
  });

  it('Set goals saves each person that changed, spreading an annual goal over the months', async () => {
    net.answer = answer(true);
    render(<GoalsView />);
    fireEvent.click(await screen.findByRole('button', { name: /set goals/i }));
    const dialog = await screen.findByRole('dialog');
    const annual = within(dialog).getAllByLabelText(/annual goal/i);
    fireEvent.change(annual[1], { target: { value: '1,200,000' } });   // Daniel: had none
    expect(within(dialog).getByText('$100,000')).toBeTruthy();          // the average a month it spread to
    fireEvent.click(within(dialog).getByRole('button', { name: /save goals/i }));
    await waitFor(() => expect(net.calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    const puts = net.calls.filter((c) => c.init?.method === 'PUT');
    expect(puts).toHaveLength(1);                                       // only Daniel changed
    expect(puts[0].url).toContain('/api/sales-goals/a2?year=2026');
    const months = JSON.parse(String(puts[0].init?.body)).months as string[];
    expect(months).toHaveLength(12);
    expect(months.every((m) => m === '100000')).toBe(true);             // 1,200,000 / 12
  });

  it('shows the server\'s reason and keeps the form open when a save is refused', async () => {
    net.answer = answer(true);
    net.putStatus = 403;
    render(<GoalsView />);
    fireEvent.click(await screen.findByRole('button', { name: /set goals/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getAllByLabelText(/annual goal/i)[1], { target: { value: '1200000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save goals/i }));
    expect(await within(dialog).findByText(/only for people on your team/i)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
