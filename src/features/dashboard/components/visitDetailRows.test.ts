import { describe, it, expect } from 'vitest';
import { visitDetailRows } from './visitDetailRows';

describe('visitDetailRows', () => {
  it('lists outcome, follow up, comments and next steps in the form order, skipping blanks', () => {
    const rows = visitDetailRows({ purpose: 'Sales Visit', outcome: 'Liked Calacatta', followUp: 'Send samples', followUpDate: '2026-11-12', managerComment: ' Good ', headquartersComment: '', nextAction: 'Quote' });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Outcome', 'Liked Calacatta'], ['Follow up', 'Send samples'], ['Follow-up date', 'Nov 12, 2026'], ['Manager comment', 'Good'], ['Next steps', 'Quote']
    ]);
  });

  it('shows a Quick Note’s comments but not outcome / follow-up text', () => {
    const rows = visitDetailRows({ purpose: 'Quick Note', outcome: 'x', followUp: 'y', managerComment: 'Will remove from SPS', headquartersComment: 'Removed' });
    expect(rows.map((r) => r.label)).toEqual(['Manager comment', 'HQ comment']);
  });

  it('prefers freshly read comments over the list’s copy', () => {
    const rows = visitDetailRows({ purpose: 'Sales Visit', managerComment: 'old' }, { managerComment: 'new', headquartersComment: '' });
    expect(rows.map((r) => r.value)).toEqual(['new']);
  });
});
