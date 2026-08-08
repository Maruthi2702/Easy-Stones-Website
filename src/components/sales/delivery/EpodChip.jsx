import React from 'react';
import { ShieldCheck, RotateCcw } from 'lucide-react';

/**
 * Proof-of-delivery badge for a delivery card.
 *
 * Reads `pod.verified`, which the server derives from the record — a delivery
 * being marked complete says nothing about whether the customer signed for it,
 * so the two are shown separately from the status pill.
 *
 * "No ePOD" renders as plain text rather than a button: a card with no proof
 * shouldn't offer a control implying there is a document to open.
 */
const EpodChip = ({ delivery, onViewPod }) => {
  const pod = delivery?.pod;
  if (!pod) return <span className="epod-chip epod-chip-none">No ePOD</span>;

  if (pod.verified) {
    return (
      <button
        type="button"
        className="epod-chip epod-chip-verified"
        onClick={(e) => { e.stopPropagation(); onViewPod?.(delivery); }}
        title="View the signed proof of delivery"
      >
        <ShieldCheck size={11} /> ePOD
      </button>
    );
  }

  // Cleared but not yet re-signed — still worth opening, since the viewer shows
  // who voided the previous signature and why.
  if (pod.clearedAt) {
    return (
      <button
        type="button"
        className="epod-chip epod-chip-cleared"
        onClick={(e) => { e.stopPropagation(); onViewPod?.(delivery); }}
        title="Signature was cleared — awaiting a new one"
      >
        <RotateCcw size={11} /> Awaiting re-sign
      </button>
    );
  }

  return <span className="epod-chip epod-chip-none">No ePOD</span>;
};

export default EpodChip;
