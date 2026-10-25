import { Loader2 } from 'lucide-react';

/** The spinner while a list or a panel loads. */
export function Loading() {
  return <div className="fr-loading"><Loader2 size={28} className="fr-spin" aria-label="Loading" /></div>;
}
