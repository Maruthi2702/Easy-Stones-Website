import React from 'react';
import type { Hold, HoldLine } from '../types';

/** The Notes tab: internal and commission notes (Edit opens the hold's form) and each slab's note. */
export default function HoldNotes({ hold, canEdit, onEdit }: { hold: Hold; canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="hl-notes">
      <section className="hl-sec">
        <h3>Internal notes {canEdit ? <button type="button" className="hl-link" onClick={onEdit}>Edit</button> : null}</h3>
        <p className="hl-pre">{hold.notes || <span className="hl-muted">None</span>}</p>
      </section>
      <section className="hl-sec">
        <h3>Commission notes</h3>
        <p className="hl-pre">{hold.commissionNotes || <span className="hl-muted">None</span>}</p>
      </section>
      <section className="hl-sec">
        <h3>Slab notes</h3>
        {hold.lines.some((l: HoldLine) => l.note) ? (
          <dl className="hl-kv">
            {hold.lines.filter((l: HoldLine) => l.note).map((l: HoldLine) => <React.Fragment key={l.slabKey}><dt>{l.serial || l.slabKey}</dt><dd>{l.note}</dd></React.Fragment>)}
          </dl>
        ) : <p className="hl-muted">None</p>}
      </section>
    </div>
  );
}
