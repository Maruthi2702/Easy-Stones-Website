import { ChevronRight, Loader2 } from 'lucide-react';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { shiftDay } from '../../../components/shared/calendar/calendarDates';
import { LocationBlocked, LocationLine } from '../../location';
import { canSave, confirmRows } from '../assistantMachine';
import type { EditableField } from '../assistantMachine';
import { dayLabel } from '../assistantFormat';
import type { Assistant } from '../useAssistant';

export type EditTarget = EditableField | null;

/** The one place a day is changed: Today / Yesterday in one tap, or any day from the shared calendar (never a native date input). */
function DayEdit({ a, onDone }: { a: Assistant; onDone: () => void }) {
  const today = a.state.today;
  const value = a.state.draft.visitDate || today;
  const set = (day: string) => { a.edit('visitDate', day); onDone(); };
  return (
    <div className="va-edit">
      <div className="va-choices">
        <button type="button" className={`va-choice${value === today ? ' is-on' : ''}`} onClick={() => set(today)}>Today</button>
        <button type="button" className={`va-choice${value === shiftDay(today, -1) ? ' is-on' : ''}`} onClick={() => set(shiftDay(today, -1))}>Yesterday</button>
      </div>
      <DatePicker id="va-day" value={value} max={today} today={today} onChange={(day) => day && set(day)} ariaLabel="Day of the visit" sheetTitle="Day of the visit" />
    </div>
  );
}

function TypeEdit({ a, onDone }: { a: Assistant; onDone: () => void }) {
  return (
    <div className="va-edit">
      <div className="va-choices" role="group" aria-label="Visit type">
        {a.types.map((t) => (
          <button
            key={t.name} type="button" className={`va-choice${a.state.draft.visitType === t.name ? ' is-on' : ''}`}
            onClick={() => { a.pickType(t.name as string); onDone(); }}
          >{t.label || t.name}</button>
        ))}
      </div>
    </div>
  );
}

/** "Does this look right?": every row is a button that fixes it. Save waits for the location reading. */
export default function ConfirmView({ a, edit, setEdit }: { a: Assistant; edit: EditTarget; setEdit: (t: EditTarget) => void }) {
  const s = a.state;
  const saving = s.phase === 'saving';
  const labelOfType = (name: string) => a.types.find((t) => t.name === name)?.label || name;
  const rows = confirmRows(s, labelOfType, (iso) => dayLabel(iso, s.today));
  const locationReady = a.location.status === 'ready' && Boolean(a.location.reading);
  const blocked = a.location.status === 'blocked';

  const onRow = (field: string) => {
    if (saving) return;
    if (field === 'customer') { a.openSearch(); return; }
    setEdit(edit === field ? null : (field as EditableField));
  };

  if (blocked) return <LocationBlocked what="a visit" onRetry={a.location.retry} />;

  return (
    <>
      <h2 className="va-q va-in" id="va-question">Does this look right?</h2>
      <div className="va-rows" role="list">
        {rows.map((r, i) => (
          <div key={r.field} role="listitem" className="va-row va-in" style={{ ['--i' as string]: i }}>
            <button
              type="button" className="va-row-btn" disabled={saving} aria-expanded={edit === r.field || undefined}
              aria-label={`${r.label}: ${r.value || 'Not mentioned'}. Change`} onClick={() => onRow(r.field)}
            >
              <span className="va-row-text">
                <span className="va-row-label">{r.label}</span>
                <span className={`va-row-value${r.empty ? ' is-empty' : ''}`}>{r.value || 'Not mentioned'}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            {edit === 'visitType' && r.field === 'visitType' && <TypeEdit a={a} onDone={() => setEdit(null)} />}
            {edit === 'visitDate' && r.field === 'visitDate' && <DayEdit a={a} onDone={() => setEdit(null)} />}
          </div>
        ))}
      </div>
      <LocationLine location={a.location} />
      <div className="va-actions">
        <button type="button" className="va-btn va-btn-ghost" disabled={saving} onClick={a.openForm}>Open the form</button>
        <button type="button" className="va-btn va-btn-main va-grow" disabled={saving || !canSave({ ...s, phase: 'confirm' }, locationReady)} onClick={a.save}>
          {saving ? <><Loader2 size={16} className="va-spin" aria-hidden="true" />Saving…</> : 'Save visit'}
        </button>
      </div>
    </>
  );
}
