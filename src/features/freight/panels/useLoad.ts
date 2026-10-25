import { useEffect, useState } from 'react';
import type { DependencyList } from 'react';

/** Load something for a panel, again whenever `reloadKey` moves on. */
export function useLoad<T>(loader: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data: T | null; error: string }>({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, error: '' }));
    loader().then((data) => live && setState({ data, error: '' })).catch((err: Error) => live && setState({ data: null, error: err.message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
