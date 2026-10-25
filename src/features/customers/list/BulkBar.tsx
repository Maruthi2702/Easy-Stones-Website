import React, { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Navigation, Mail, UserPlus, CircleDot, Download, Trash2, Undo2, X } from 'lucide-react';
import { STATUSES, statusMeta, groupRepsByLocation } from '../../../utils/customerList';
import { useDismiss, anchoredMenuStyle } from './uiHelpers';
import type { FilterGroup } from './parts';
import type { Loose } from '../../../types/records';

/** A bulk-bar button that opens a pick-one list above the bar. */
const PickOne = ({ icon, label, groups, onPick, disabled }: { icon: LucideIcon; label: string; groups: FilterGroup[]; onPick: (value: string) => void; disabled?: boolean }) => {
  const Icon = icon;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
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

/**
 * The Customer List's selection bar. `onDelete` (only for the Delete switch)
 * adds Delete; after a delete, `undo` ({ message, onUndo, onDismiss, busy })
 * keeps the bar up with the result and an Undo button even though nothing
 * is selected any more.
 */
export type BulkUndo = { message: string; busy: boolean; onUndo: (() => void) | null; onDismiss: () => void };
export type BulkBarProps = {
  count: number;
  canEdit: boolean;
  salesReps: Loose[];
  onPlanRoute: (() => void) | null;
  onCopyEmails: () => void;
  onAssignRep: (repId: string) => void;
  onSetStatus: (status: string) => void;
  onExport: (() => void) | null;
  onDelete: (() => void) | null;
  onClear: () => void;
  busy: boolean;
  message: string;
  undo?: BulkUndo | null;
};

const BulkBar = ({ count, canEdit, salesReps, onPlanRoute, onCopyEmails, onAssignRep, onSetStatus, onExport, onDelete, onClear, busy, message, undo = null }: BulkBarProps) => {
  if (!count && undo) {
    return (
      <div className="cl-bulk cl" role="region" aria-label="Deleted customers">
        <b aria-live="polite">{undo.message}</b>
        {undo.onUndo && (
          <button type="button" className="cl-bb undo" onClick={undo.onUndo} disabled={undo.busy}>
            <Undo2 size={16} aria-hidden="true" />{undo.busy ? 'Restoring…' : 'Undo'}
          </button>
        )}
        <button type="button" className="cl-bb" aria-label="Dismiss" onClick={undo.onDismiss} disabled={undo.busy}><X size={16} /></button>
      </div>
    );
  }
  if (!count) return null;
  const repGroups: FilterGroup[] = [
    { group: null, options: [{ value: '', label: 'Unassigned (hand back)' }] },
    ...groupRepsByLocation(salesReps).map(g => ({ group: g.location, options: g.reps.map((r: Loose) => ({ value: r._id, label: r.name })) }))
  ];
  const statusGroups: FilterGroup[] = [{ group: null, options: STATUSES.map(s => ({ value: s, label: s, dot: statusMeta(s).tone })) }];

  return (
    <div className="cl-bulk cl" role="region" aria-label="Selected customers">
      <b aria-live="polite">{message || `${count} selected`}</b>
      {onPlanRoute && (
        <button type="button" className="cl-bb gold" onClick={onPlanRoute} disabled={busy}><Navigation size={16} aria-hidden="true" />Plan route</button>
      )}
      <button type="button" className="cl-bb" onClick={onCopyEmails} disabled={busy}><Mail size={16} aria-hidden="true" />Copy emails</button>
      {canEdit && <PickOne icon={UserPlus} label="Assign rep" groups={repGroups} onPick={onAssignRep} disabled={busy} />}
      {canEdit && <PickOne icon={CircleDot} label="Set status" groups={statusGroups} onPick={onSetStatus} disabled={busy} />}
      {onExport && <button type="button" className="cl-bb" onClick={onExport} disabled={busy}><Download size={16} aria-hidden="true" />Export</button>}
      {onDelete && <button type="button" className="cl-bb danger" onClick={onDelete} disabled={busy}><Trash2 size={16} aria-hidden="true" />Delete</button>}
      <button type="button" className="cl-bb" aria-label="Clear selection" onClick={onClear}><X size={16} /></button>
    </div>
  );
};

export default BulkBar;
