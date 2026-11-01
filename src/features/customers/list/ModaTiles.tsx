import { useState } from 'react';
import { useModaSummary } from '../../../api/modaSummary';
import { useResourceTypes } from '../../../api/typeLists';
import type { Loose } from '../../../types/records';

/*
 * The drawer's Moda Resources tiles. Display and Binders are counted from the
 * customer's Active Display tower / Sample binder resources plus what was
 * counted before resources were logged (src/utils/modaTotals.ts). Under each
 * number is the newest resource behind it; the binder line opens how the total
 * adds up. Until the counts load (or if they can't), the stored values show.
 * Design: claude.ai artifact "Moda counts from resources"
 * (https://claude.ai/artifact/RwLQGxLHFaVfpf8HiinAEk).
 */

const shortDate = (d: string) => {
  const date = new Date(`${d}T12:00:00`);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function ModaTiles({ customer }: { customer: Loose }) {
  // The list row refreshes after a save anywhere; its stored values changing asks again.
  const summary = useModaSummary(customer._id, `${customer.modaDisplay}|${customer.modaBinder}|${customer.updatedAt || ''}`);
  const { types } = useResourceTypes();
  const [open, setOpen] = useState(false);
  const labelOf = (name: string) => types.find((t) => t.name === name)?.label || name;

  const display = summary ? summary.display : customer.modaDisplay === 'Yes';
  const binders = summary ? summary.binders : parseInt(customer.modaBinder, 10) || 0;
  const active = (summary?.items || []).filter((i) => i.status === 'Active');
  const tower = active.find((i) => i.kind === 'display');
  const binderItems = active.filter((i) => i.kind === 'binders');
  const newest = binderItems[0];

  return (
    <>
      <div className="cl-tiles">
        <div className="cl-tile">
          <span className="cl-muted" style={{ fontSize: 12.5 }}>Display</span>
          <b style={{ color: display ? 'var(--cl-ok-ink)' : 'var(--cl-muted)' }}>{display ? 'Installed' : 'None'}</b>
          {tower && <span className="cl-mt-sub">{labelOf(tower.type)}{tower.date ? ` · ${shortDate(tower.date)}` : ''}</span>}
        </div>
        <div className="cl-tile">
          <span className="cl-muted" style={{ fontSize: 12.5 }}>Binders</span>
          <b className="cl-mt-num">{binders}</b>
          {newest && (
            <button type="button" className="cl-mt-link" aria-expanded={open} aria-controls="cl-mt-break" onClick={() => setOpen((o) => !o)}>
              {newest.qty} added{newest.date ? ` ${shortDate(newest.date)}` : ''}
            </button>
          )}
        </div>
      </div>
      {open && summary && (
        <div className="cl-mt-break" id="cl-mt-break">
          {binderItems.map((i) => (
            <div key={i._id}><span>{labelOf(i.type)}{i.date ? ` · ${shortDate(i.date)}` : ''}</span><span>{i.qty}</span></div>
          ))}
          {summary.earlier.binders > 0 && (
            <div><span>Counted before resources were logged</span><span>{summary.earlier.binders}</span></div>
          )}
          <div className="cl-mt-total"><span>Total binders</span><span>{summary.binders}</span></div>
        </div>
      )}
    </>
  );
}
