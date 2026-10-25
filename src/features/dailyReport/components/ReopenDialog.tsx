import type { Dispatch, SetStateAction } from 'react';
import { Unlock } from 'lucide-react';
import { longDate } from '../reportFigures';

/** Reopening a signed-off day states why, on the record. The reason is the page's, so it survives Cancel. */
export default function ReopenDialog({ date, reopenReason, setReopenReason, setReopenOpen, reopenDay }: {
  date: string;
  reopenReason: string;
  setReopenReason: Dispatch<SetStateAction<string>>;
  setReopenOpen: Dispatch<SetStateAction<boolean>>;
  reopenDay: () => void;
}) {
  return (
    <div className="dr-confirm-backdrop" onClick={() => setReopenOpen(false)}>
      <div className="dr-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="dr-confirm-badge"><Unlock size={20} /></div>
        <h4>Reopen {longDate(date)}?</h4>
        <p>The day goes back to draft and can be edited again. Your name and reason are kept on the report.</p>
        <label className="dr-confirm-label" htmlFor="dr-reopen-reason">Reason <span className="dr-req">*</span></label>
        <input
          id="dr-reopen-reason"
          className="dr-cell is-left no-capitalize"
          style={{ width: '100%' }}
          value={reopenReason}
          autoFocus
          placeholder="e.g. container slabs were counted twice"
          onChange={(e) => setReopenReason(e.target.value)}
        />
        <div className="dr-confirm-actions">
          <button className="dr-btn" onClick={() => setReopenOpen(false)}>Cancel</button>
          <button className="dr-btn dr-btn--gold" disabled={reopenReason.trim().length < 4} onClick={reopenDay}>
            Reopen day
          </button>
        </div>
      </div>
    </div>
  );
}
