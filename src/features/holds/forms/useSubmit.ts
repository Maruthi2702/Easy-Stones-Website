import { useState } from 'react';

/** saving / server error around one submit. */
export function useSubmit() {
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const submit = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setServerError('');
    try { await fn(); } catch (err) { setServerError((err as Error).message); setSaving(false); }
  };
  return { saving, serverError, submit };
}
