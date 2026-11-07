import { sizeText, type Step } from '../../../utils/supplierBlocks';
import { timeAgo } from '../supplierPosView';
import type { Block } from '../types';

/**
 * A queue of blocks waiting for one step (Waiting for review / Final
 * approval): the photos waiting, what the block is, who offered it and how
 * long it's waited — the longest first. A block whose bundles this person
 * approved in step 1 says so in the Final approval queue (someone else gives it).
 */
export default function BlockQueue({ blocks, step, onOpen, empty }: { blocks: Block[]; step: Step; onOpen: (b: Block) => void; empty: React.ReactNode }) {
  if (!blocks.length) return <div className="sp-empty">{empty}</div>;
  const status = step === 1 ? 'review' : 'final';
  return (
    <div className="sp-queue">
      {blocks.map((b) => {
        const waiting = b.bundles.filter((x) => x.status === status);
        const slabs = waiting.reduce((s, x) => s + (Number(x.slabs) || 0), 0);
        const mine = b.decidable[step].length;
        const resent = waiting.some((x) => x.round > 1);
        return (
          <button key={b.id} type="button" className="sp-qcard" onClick={() => onOpen(b)}>
            <span className="sp-qphotos" aria-hidden="true">
              {waiting.slice(0, 4).map((x) => (x.photoUrl ? <img key={x.id} src={x.photoUrl} alt="" loading="lazy" /> : <span key={x.id} className="sp-qph" />))}
              {waiting.length > 4 ? <span className="sp-qmore">+{waiting.length - 4}</span> : null}
            </span>
            <span className="sp-qbody">
              <span className="sp-qtop"><b>Block {b.blockNumber}</b><span className="sp-sub">PO {b.poNumber}</span>{resent ? <span className="sp-tag is-info">Changes sent</span> : null}</span>
              <span>{b.material}{b.thickness ? ` ${b.thickness}` : ''}{b.finish ? ` · ${b.finish}` : ''}</span>
              <span className="sp-sub">{b.supplierName}{b.supplierCountry ? ` (${b.supplierCountry})` : ''} · {waiting.length} bundle{waiting.length === 1 ? '' : 's'}, {slabs} slabs{b.size ? ` · ${sizeText(b.size).split(' · ')[0]}` : ''} · ships to {b.shipTo}</span>
              {step === 2 && !mine ? <span className="sp-sub is-warn">You approved these in step 1 — someone else gives the final approval.</span> : null}
            </span>
            <span className="sp-qwhen">
              <span className="sp-sub">Waiting</span>
              <b>{timeAgo(waiting.map((x) => x.sentAt).filter(Boolean).sort()[0] || b.sentAt).replace(' ago', '')}</b>
            </span>
          </button>
        );
      })}
    </div>
  );
}
