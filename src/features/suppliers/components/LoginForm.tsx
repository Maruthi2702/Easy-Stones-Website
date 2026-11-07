import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker, FormSection } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { cleanLogin } from '../../../utils/supplierBlocks';
import type { Meta, SupplierLoginInfo, SupplierRow } from '../types';

type Body = { name: string; email: string; language: string };

/**
 * A supplier's portal login (one person per supplier for now). Adding one
 * emails them an invite in their language; they choose their own password.
 */
export default function LoginForm({ supplier, login, meta, onSave, onClose }: { supplier: SupplierRow; login?: SupplierLoginInfo | null; meta: Meta; onSave: (body: Body) => Promise<unknown>; onClose: () => void }) {
  const editing = Boolean(login);
  const start: Body = { name: login?.name || supplier.contactName || '', email: login?.email || supplier.email || '', language: login?.language || supplier.language || 'en' };
  const [v, setV] = useState<Body>(start);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const set = (patch: Partial<Body>) => { setV((x) => ({ ...x, ...patch })); setServerProblems({}); setServerError(''); };
  const check = cleanLogin(v, meta.languages.map((l) => l.code));
  const problems = { ...check.problems, ...serverProblems };
  const errors = submitted ? problems : {};
  const dirty = (Object.keys(start) as (keyof Body)[]).filter((k) => start[k] !== v[k]).length;

  const submit = async () => {
    setSubmitted(true);
    const first = (['name', 'email', 'language'] as const).find((k) => problems[k]);
    if (first) { goToField(first); return; }
    setSaving(true);
    try { await onSave(v); } catch (err) {
      const e = err as Error & { problems?: Record<string, string> };
      setServerProblems(e.problems || {});
      setServerError(e.message);
      setSaving(false);
    }
  };

  return (
    <FormModal title={<>{editing ? 'Edit login' : 'Add login'} <span className="fm-title-sub">· {supplier.name}</span></>} size="s" onClose={onClose} onSubmit={submit}
      submitLabel={editing ? 'Save changes' : 'Save and email the invite'} saving={saving} submitDisabled={editing && !dirty} dirtyCount={dirty}
      errors={errors} showErrors={submitted} fieldLabels={{ name: 'Name', email: 'Email', language: 'Language' }}
      footerNote={editing ? (v.email !== start.email ? 'A new email signs them out everywhere.' : null) : 'They get a link to choose their password. It works once, for 7 days.'}>
      {serverError ? <div className="sp-form-error" role="alert">{serverError}</div> : null}
      <FormSection>
        <FormField name="name" id="login-name" label="Name" required error={errors.name}>
          <input id="login-name" className="fm-input" value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField name="email" id="login-email" label="Email" required error={errors.email} status="They sign in with it">
          <input id="login-email" className="fm-input no-capitalize" type="email" value={v.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
        </FormField>
        <FormField name="language" id="login-lang" label="Language" error={errors.language}>
          <FormPicker id="login-lang" value={v.language} onChange={(language) => set({ language })} sheetTitle="Language" keepInForm
            options={meta.languages.map((l) => ({ value: l.code, label: l.code === 'en' ? 'English' : `${l.english} · ${l.name}` }))} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
