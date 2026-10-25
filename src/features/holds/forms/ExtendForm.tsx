import { useMemo, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { todayIn, addDays, MAX_HOLD_DAYS } from '../../../holds/holdRules';
import { branchZone } from '../../../config/branches';
import { extendChoices, longDate, dayMonth } from '../../../utils/holdView';
import type { Hold } from '../types';
import { ServerError } from './formParts';
import { useSubmit } from './useSubmit';

/** Move the hold date — 7, 14 or 30 days on, or any date. Needs the Extend permission. */
export default function ExtendForm({ hold, onSave, onClose }: { hold: Hold; onSave: (expiresOn: string) => Promise<unknown>; onClose: () => void }) {
  const choices = useMemo(() => extendChoices(hold), [hold]);
  const today = todayIn(branchZone(hold.branch));
  const [expiresOn, setExpiresOn] = useState(choices[0].expiresOn);
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const latest = addDays(today, MAX_HOLD_DAYS);
  const error = !expiresOn ? 'Pick the date.' : expiresOn < today ? 'The date can’t be in the past.' : expiresOn > latest ? `A hold can run for up to ${MAX_HOLD_DAYS} days.` : '';

  return (
    <FormModal
      title={<>Extend hold <span className="fm-title-sub">· #{hold.number}</span></>}
      size="s"
      onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (error) { goToField('expiresOn'); return; } submit(() => onSave(expiresOn)); }}
      submitLabel={expiresOn ? `Hold until ${dayMonth(expiresOn)}` : 'Extend'}
      saving={saving}
      dirtyCount={expiresOn !== hold.expiresOn ? 1 : 0}
      errors={submitted && error ? { expiresOn: error } : {}}
      showErrors={submitted}
      fieldLabels={{ expiresOn: 'Hold until' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <div className="hl-form-sum">
          <div className="k">Now held until</div>
          <div className="v">{longDate(hold.expiresOn)}</div>
        </div>
        <FormField name="expiresOn" id="hx-date" label="Hold until" required error={submitted ? error : ''}>
          <div className="hl-chips" role="radiogroup" aria-label="Quick picks">
            {choices.map((ch) => (
              <button key={ch.days} type="button" role="radio" aria-checked={expiresOn === ch.expiresOn} className={`hl-chip${expiresOn === ch.expiresOn ? ' on' : ''}`}
                disabled={saving} onClick={() => setExpiresOn(ch.expiresOn)}>
                +{ch.days} days · {dayMonth(ch.expiresOn)}
              </button>
            ))}
          </div>
          <DatePicker id="hx-date" value={expiresOn} min={today} max={latest} today={today} disabled={saving} error={submitted ? error : ''}
            sheetTitle="Hold until" shortcuts={[]} onChange={setExpiresOn} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
