import { useEffect, useState } from 'react';
/** Keep results tied to their filters; a failed/new request never shows old costs. */
export function useFuelQuery<T>(key: string, read: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data, error: '' });
    }).catch(e => { if (!controller.signal.aborted) setResult({ key, data: null, error: e.message }); });
    return () => controller.abort();
  }, [key, read]);
  return result?.key === key ? { ...result, loading: false } : { data: null, error: '', loading: true };
}
