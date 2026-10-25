import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';

/** Copy a payment ID to the clipboard; it says "Copied" for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="fr-icon-btn"
      style={{ width: 36, height: 36 }}
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); } catch { /* clipboard blocked — nothing to do */ }
      }}
    >
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}
