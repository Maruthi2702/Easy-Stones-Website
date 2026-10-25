import { slabCount } from '../../../utils/holdView';

type HoldSelectionBarProps = {
  holdNumber: number;
  count: number;
  allSelected: boolean;
  canRelease: boolean;
  confirmRemove: boolean;
  setConfirmRemove: (on: boolean) => void;
  busy: boolean;
  onClear: () => void;
  removeSelected: () => void;
};

/** The bar under ticked slabs: Clear, Remove from hold, and its "Remove 2 slabs?" confirm. */
export default function HoldSelectionBar({ holdNumber, count, allSelected, canRelease, confirmRemove, setConfirmRemove, busy, onClear, removeSelected }: HoldSelectionBarProps) {
  return (
    <div className="hl-selbar" role="region" aria-label="Selected slabs">
      {confirmRemove ? (
        <>
          <span className="hl-selbar-sum">Remove {slabCount(count)} from Hold #{holdNumber}?</span>
          <button type="button" className="hl-btn ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
          <button type="button" className="hl-btn danger-solid" disabled={busy} onClick={removeSelected}>{busy ? 'Removing…' : 'Remove'}</button>
        </>
      ) : (
        <>
          <span className="hl-selbar-sum">{count} selected</span>
          <button type="button" className="hl-btn ghost" onClick={onClear}>Clear</button>
          {allSelected ? (
            <span className="hl-selbar-note">A hold needs at least one slab{canRelease ? ' — release it instead' : ''}.</span>
          ) : (
            <button type="button" className="hl-btn dark" onClick={() => setConfirmRemove(true)}>Remove from hold</button>
          )}
        </>
      )}
    </div>
  );
}
