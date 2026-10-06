import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * The day has tickets with no branch set. They used to be counted on every
 * branch's report (all 13 sheets, and 13 times in All locations); now they're
 * counted on none until someone sets their branch on the Delivery Schedule —
 * so the sheet says so rather than leaving them silently out.
 */
const NoBranchNote = ({ count }) => {
  if (!count) return null;
  const one = count === 1;
  return (
    <div className="dr-unassigned" role="status">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>
        {one ? '1 ticket' : `${count} tickets`} on this day {one ? 'has' : 'have'} no branch,
        so {one ? 'it isn’t' : 'they aren’t'} counted on any report. Set the branch on the
        Delivery Schedule to count {one ? 'it' : 'them'}.
      </span>
    </div>
  );
};

export default NoBranchNote;
