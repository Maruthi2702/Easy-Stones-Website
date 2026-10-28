export { formatCents as money } from '../../accounting/money';
export const categoryLabels = { fuel: 'Fuel', def: 'DEF', supplies: 'Supplies', tax: 'Non-fuel taxes', adjustment: 'Credits / adjustments', other: 'Unknown charge' };
export const reasonLabels = { no_activity: 'No card activity this month', leave: 'Leave / not working', retired: 'Left company / card retired', transferred: 'Transferred location', identifier_changed: 'Employee ID changed', incomplete: 'Report incomplete', investigating: 'Still investigating' };
export const statusLabels = { draft: 'Waiting for approval', posted: 'Approved', superseded: 'Superseded', reversed: 'Reversed' };
// What each answer to "what happened?" does, so nobody has to guess at the effect.
export const reasonHelp = {
  no_activity: 'The card was not used this month. The driver is still expected next month.',
  leave: 'Away this month only. The driver is still expected next month.',
  retired: 'The card is finished. The driver is no longer expected from the date below.',
  transferred: 'Moved to another location. Match the new location in the next report that has their card.',
  identifier_changed: 'The same person now has a new employee number. The old number is no longer expected from the date below.',
  incomplete: 'The Fuelman report seems to be missing this driver. Approval stays blocked until this is settled.',
  investigating: 'Still finding out. Approval stays blocked until this is settled.',
} as const;
