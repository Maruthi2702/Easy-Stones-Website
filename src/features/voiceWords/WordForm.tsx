import { useState } from 'react';
import FormModal from '../../components/shared/form/FormModal';
import { FormField, FormPicker, SegmentedToggle } from '../../components/shared/form/FormControls';
import { goToField } from '../../components/shared/form/formFocus';
import type { VoiceWord, VoiceWordInput, VoiceWordKind } from '../../utils/assistantContract';
import { VoiceWordsError } from './voiceWordsApi';
import { KIND_OPTIONS, NOTE_MAX, WORD_MAX, changedFields, wordFormErrors, wordInput } from './voiceWordsView';
import type { WordFormValues } from './voiceWordsView';

/*
 * Add / edit one voice word, on the form template (FORM_TEMPLATE.md), size S. "Heard as" is what the phone tends to write; empty means
 * a plain word that is only a hint. A word that is already in the list (the server's 409) shows under "Heard as".
 */

const SHOWN = [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }] as const;

export type WordFormProps = {
  /** The word being edited; none = a new one. */
  word?: VoiceWord | null;
  /** Saves (add gets the whole input, edit only what changed), or throws with the reason to show. */
  onSave: (input: VoiceWordInput | Partial<VoiceWordInput>) => Promise<unknown>;
  onClose: () => void;
};

export default function WordForm({ word = null, onSave, onClose }: WordFormProps) {
  const editing = Boolean(word);
  const [values, setValues] = useState<WordFormValues>({ meant: word?.meant || '', heard: word?.heard || '', kind: word?.kind || 'other', note: word?.note || '' });
  const [active, setActive] = useState(word ? word.active : true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [server, setServer] = useState<{ field: 'meant' | 'heard' | 'form'; message: string } | null>(null);

  const set = <K extends keyof WordFormValues>(key: K, value: WordFormValues[K]) => { setValues((v) => ({ ...v, [key]: value })); setServer(null); };
  const own = wordFormErrors(values);
  const errors = {
    meant: submitted ? own.meant || (server?.field === 'meant' ? server.message : '') : server?.field === 'meant' ? server.message : '',
    heard: submitted ? own.heard || (server?.field === 'heard' ? server.message : '') : server?.field === 'heard' ? server.message : '',
    note: submitted ? own.note || '' : '',
    form: server?.field === 'form' ? server.message : ''
  };

  const patch = word ? { ...changedFields(values, word), ...(active !== word.active ? { active } : {}) } : {};
  const dirty = editing ? Object.keys(patch).length : [values.meant.trim(), values.heard.trim(), values.note.trim()].filter(Boolean).length + (values.kind !== 'other' ? 1 : 0);

  const submit = async () => {
    setSubmitted(true); setServer(null);
    const first = (['meant', 'heard', 'note'] as const).find((k) => own[k]);
    if (first) { goToField(first); return; }
    setSaving(true);
    try {
      await onSave(word ? patch : { ...wordInput(values), active });
      onClose();
    } catch (error) {
      const e = error as VoiceWordsError;
      if (e.status === 409) {
        const target = values.heard.trim() ? 'heard' : 'meant';
        setServer({ field: target, message: `“${(values.heard.trim() || values.meant.trim())}” is already in the list` });
        goToField(target);
      } else {
        setServer({ field: 'form', message: e.message || 'Could not save' });
      }
    } finally { setSaving(false); }
  };

  return (
    <FormModal
      title={editing ? 'Edit word' : 'Add word'}
      size="s"
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      submitLabel={editing ? 'Save changes' : 'Add word'}
      saving={saving}
      submitDisabled={editing && dirty === 0}
      dirtyCount={dirty}
      errors={errors}
      showErrors={submitted || Boolean(server)}
      fieldLabels={{ meant: 'Meant', heard: 'Heard as', note: 'Note', form: 'Saving' }}
    >
      <FormField name="meant" id="vw-meant" label="Meant" required error={errors.meant}>
        <input id="vw-meant" className="fm-input no-capitalize" value={values.meant} maxLength={WORD_MAX + 20} autoComplete="off"
          placeholder="Calacatta Gold" onChange={(e) => set('meant', e.target.value)}
          aria-invalid={errors.meant ? 'true' : undefined} aria-describedby={errors.meant ? 'vw-meant-msg' : undefined} />
      </FormField>
      <FormField name="heard" id="vw-heard" label="Heard as" error={errors.heard}>
        <input id="vw-heard" className="fm-input no-capitalize" value={values.heard} maxLength={WORD_MAX + 20} autoComplete="off"
          placeholder="what the phone tends to write" onChange={(e) => set('heard', e.target.value)}
          aria-invalid={errors.heard ? 'true' : undefined} aria-describedby={errors.heard ? 'vw-heard-msg' : undefined} />
      </FormField>
      <FormField name="kind" id="vw-kind" label="Kind">
        <FormPicker id="vw-kind" value={values.kind} onChange={(v) => set('kind', v as VoiceWordKind)} options={KIND_OPTIONS} sheetTitle="Kind" />
      </FormField>
      <FormField name="active" id="vw-active" label="In the list">
        <SegmentedToggle label="In the list" value={active ? 'on' : 'off'} onChange={(v) => setActive(v === 'on')} options={[...SHOWN]} />
      </FormField>
      <FormField name="note" id="vw-note" label="Note" error={errors.note}>
        <textarea id="vw-note" className="fm-input no-capitalize" rows={3} value={values.note} maxLength={NOTE_MAX + 40}
          onChange={(e) => set('note', e.target.value)} aria-invalid={errors.note ? 'true' : undefined} aria-describedby={errors.note ? 'vw-note-msg' : undefined} />
      </FormField>
      {errors.form ? <div className="vw-error" role="alert">{errors.form}</div> : null}
    </FormModal>
  );
}
