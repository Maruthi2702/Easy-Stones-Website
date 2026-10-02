import React, { useRef, useState } from 'react';
import { Navigation, Mail, UserPlus, CircleDot, Download, X } from 'lucide-react';
import { STATUSES, statusMeta, groupRepsByLocation } from '../../../utils/customerList';
import { useDismiss, anchoredMenuStyle } from './uiHelpers';

/** A bulk-bar button that opens a pick-one list above the bar. */
const PickOne = ({ icon, label, groups, onPick, disabled }) => {
  const Icon = icon;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(undefined);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref, { closeOnScroll: true });
  return (
    <div className="cl-rowmenu" ref={ref}>
      <button type="button" className="cl-bb" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={(e) => { setPos(anchoredMenuStyle(e.currentTarget, { estHeight: 360 })); setOpen(o => !o); }}>
        <Icon size={16} aria-hidden="true" />{label}
      </button>
      {open && (
        <div className="cl-pop" role="menu" style={{ minWidth: 230, ...pos }}>
          {groups.map((g, gi) => (
            <React.Fragment key={g.group || gi}>
              {g.group && <div className="cl-pop-grp">{g.group}</div>}
              {g.options.map(o => (
                <button key={String(o.value)} type="button" role="menuitem" className="cl-opt" onClick={() => { setOpen(false); onPick(o.value); }}>
                  {o.dot && <span className={`cl-dot ${o.dot}`} aria-hidden="true" />}
                  {o.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

const BulkBar = ({ count, canEdit, salesReps, onPlanRoute, onCopyEmails, onAssignRep, onSetStatus, onExport, onClear, busy, message }) => {
  if (!count) return null;
  const repGroups = [
    { group: null, options: [{ value: '', label: 'Unassigned (hand back)' }] },
    ...groupRepsByLocation(salesReps).map(g => ({ group: g.location, options: g.reps.map(r => ({ value: r._id, label: r.name })) }))
  ];
  const statusGroups = [{ group: null, options: STATUSES.map(s => ({ value: s, label: s, dot: statusMeta(s).tone })) }];

  return (
    <div className="cl-bulk cl" role="region" aria-label="Selected customers">
      <b aria-live="polite">{message || `${count} selected`}</b>
      {onPlanRoute && (
        <button type="button" className="cl-bb gold" onClick={onPlanRoute} disabled={busy}><Navigation size={16} aria-hidden="true" />Plan route</button>
      )}
      <button type="button" className="cl-bb" onClick={onCopyEmails} disabled={busy}><Mail size={16} aria-hidden="true" />Copy emails</button>
      {canEdit && <PickOne icon={UserPlus} label="Assign rep" groups={repGroups} onPick={onAssignRep} disabled={busy} />}
      {canEdit && <PickOne icon={CircleDot} label="Set status" groups={statusGroups} onPick={onSetStatus} disabled={busy} />}
      <button type="button" className="cl-bb" onClick={onExport} disabled={busy}><Download size={16} aria-hidden="true" />Export</button>
      <button type="button" className="cl-bb" aria-label="Clear selection" onClick={onClear}><X size={16} /></button>
    </div>
  );
};

export default BulkBar;
