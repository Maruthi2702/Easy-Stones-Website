import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormSection } from '../../../components/shared/form/FormControls';
import type { Block } from '../types';

/**
 * Unlock approved bundles (owner, 2026-11-06): the supplier asked to change
 * them. Each goes back to the supplier and, once changed, through both steps
 * again. The reason is kept on the block and sent to the supplier.
 */
export default function UnlockForm({ block, onUnlock, onClose }: { block: Block; onUnlock: (ids: string[], reason: string) => Promise<unknown>; onClose: () => void }) {
  const approved = block.bundles.filter((b) => b.status === 'approved');
  const [ids, setIds] = useState<string[]>(approved.length === 1 ? [approved[0]!.id] : []);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const errors = { bundles: ids.length ? '' : 'Choose the bundles to unlock', reason: reason.trim() ? '' : 'Say why it’s being unlocked' };
  const shown: Partial<typeof errors> = submitted ? errors : {};

  const submit = async () => {
    setSubmitted(true);
    if (errors.bundles || errors.reason) return;
    setSaving(true);
    setServerError('');
    try { await onUnlock(ids, reason.trim()); } catch (e) { setServerError((e as Error).message); setSaving(false); }
  };

  return (
    <FormModal title={<>Unlock bundles <span className="fm-title-sub">· Block {block.blockNumber}</span></>} size="s" onClose={onClose} onSubmit={submit}
      submitLabel={`Unlock ${ids.length || ''} bundle${ids.length === 1 ? '' : 's'}`.replace('  ', ' ')} saving={saving}
      dirtyCount={ids.length + (reason ? 1 : 0)} discardTitle="Discard this unlock?" errors={shown} showErrors={submitted}
      fieldLabels={{ bundles: 'Bundles', reason: 'Why' }}
      footerNote="The supplier gets an email. Changed bundles go through both steps again.">
      {serverError ? <div className="sp-form-error" role="alert">{serverError}</div> : null}
      <FormSection>
        <FormField name="bundles" id="sp-unlock-0" label="Bundles" required error={shown.bundles}>
          <div className="sp-checks">
            {approved.map((b, i) => (
              <label key={b.id} className="sp-check">
                <input id={i === 0 ? 'sp-unlock-0' : undefined} type="checkbox" checked={ids.includes(b.id)}
                  onChange={(e) => setIds((list) => (e.target.checked ? [...list, b.id] : list.filter((x) => x !== b.id)))} />
                Bundle {b.n} · {b.slabs} slabs
              </label>
            ))}
          </div>
        </FormField>
        <FormField name="reason" id="sp-unlock-reason" label="Why" required error={shown.reason}>
          <textarea id="sp-unlock-reason" className="fm-input fm-textarea" rows={3} maxLength={300} autoCapitalize="sentences"
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The supplier says bundle 4 holds 7 slabs, not 8" />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
