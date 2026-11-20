import { useState } from 'react';
import FormModal from '../../components/shared/form/FormModal';
import { FormField } from '../../components/shared/form/FormControls';
import { REASON_MAX, cleanReason } from '../../utils/locationRequests';

/**
 * "Locate now" (src/utils/locationRequests.ts): asks one person's phone for its location once.
 * A reason is required and is kept with the ask; the person is told by a notification. On the
 * form template (FormModal, S size).
 */
export default function LocateDialog({ name, sending, error, onAsk, onClose }: {
  name: string; sending: boolean; error: string; onAsk: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const { problem } = cleanReason(reason);

  return (
    <FormModal
      title={`Locate ${name}`}
      size="s"
      submitLabel="Ask for location"
      savingLabel="Asking…"
      saving={sending}
      dirtyCount={reason.trim() ? 1 : 0}
      errors={{ reason: touched ? problem : '' }}
      showErrors={touched}
      fieldLabels={{ reason: 'Reason' }}
      onClose={onClose}
      onSubmit={() => { setTouched(true); if (!problem) onAsk(reason); }}
    >
      {error ? <p role="alert" className="tl-ask-error">{error}</p> : null}
      <FormField name="reason" id="tl-reason" label="Why do you need it?" required error={touched ? problem : ''}>
        <textarea id="tl-reason" className="fm-input" rows={3} maxLength={REASON_MAX} value={reason} disabled={sending}
          autoCapitalize="sentences" onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <p className="tl-ask-note">{name}’s phone is asked once and gets a notification that you asked. Your name, the time, this reason and their answer are kept for 90 days.</p>
    </FormModal>
  );
}
