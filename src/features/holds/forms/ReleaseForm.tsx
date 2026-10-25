import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { slabCount } from '../../../utils/holdView';
import type { Hold } from '../types';
import { ServerError } from './formParts';
import { useSubmit } from './useSubmit';

const RELEASE_REASONS = ['Customer passed', 'Chose other slabs', 'Bought elsewhere', 'Duplicate hold'];

/** Release: a reason is required; the slabs are free the moment it's saved. */
export default function ReleaseForm({ hold, onRelease, onClose }: { hold: Hold; onRelease: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const error = reason.trim() ? '' : 'Say why it’s being released.';

  return (
    <FormModal
      title={<>Release hold <span className="fm-title-sub">· #{hold.number}</span></>}
      size="s"
      onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (error) { goToField('reason'); return; } submit(() => onRelease(reason.trim())); }}
      submitLabel={`Release ${slabCount(hold.lines.length)}`}
      savingLabel="Releasing…"
      saving={saving}
      dirtyCount={reason.trim() ? 1 : 0}
      discardTitle="Close without releasing?"
      errors={submitted && error ? { reason: error } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <div className="hl-form-sum">
          <div className="k">{hold.customer?.name}</div>
          <div className="v">{slabCount(hold.lines.length)}</div>
          <div className="s">Free for anyone to hold again once released. The hold stays on record under Released.</div>
        </div>
        <FormField name="reason" id="hr-reason" label="Reason" required error={submitted ? error : ''}>
          <div className="hl-chips">
            {RELEASE_REASONS.map((r) => (
              <button key={r} type="button" className={`hl-chip${reason === r ? ' on' : ''}`} disabled={saving} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <textarea id="hr-reason" className="fm-input" rows={2} value={reason} maxLength={300} disabled={saving} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
