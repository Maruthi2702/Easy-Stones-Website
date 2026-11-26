import { AlertTriangle } from 'lucide-react';

/**
 * Checks worth a look that never stop a save (2026-11-24): the same photo already on a receipt, subtotal + fees + tax + tip
 * not adding up to the total. Empty lines are left out.
 */
export default function WarnLines({ lines }: { lines: readonly string[] }) {
  const shown = lines.filter(Boolean);
  if (!shown.length) return null;
  return (
    <>
      {shown.map((line) => (
        <p key={line} className="ccr-warn-line" role="status"><AlertTriangle size={15} aria-hidden="true" /><span>{line}</span></p>
      ))}
    </>
  );
}
