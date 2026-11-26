import { Camera, FileText, Pencil, Plus } from 'lucide-react';
import { formatMoney, parseCents } from '../../../utils/cardReceipts';
import { isPdfUrl } from '../cardReceiptsView';
import WarnLines from './WarnLines';

export type BillValues = { merchant: string; date: string; total: string; subtotal: string; fees: string; tax: string; tip: string };
export type BillField = keyof BillValues;

const money = (typed: string) => {
  const cents = parseCents(typed);
  return cents == null ? '' : Number.isNaN(cents) ? typed : formatMoney(cents);
};
const dayLabel = (day: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

type Props = BillValues & {
  receiptUrl: string;
  /** "I lost the receipt": no photo, a receipt icon instead. */
  lost: boolean;
  uploading: boolean;
  /** "Reading the receipt…" / what was filled in. */
  note: string;
  /** 'check': what was read off the receipt, shown in red so it gets looked at. */
  noteTone?: 'check';
  viewingLarge: boolean;
  /** Checks that don't stop a save: the same photo twice, the parts not adding up to the total. */
  warnings?: readonly string[];
  /** The photo slot: take / choose a photo when there is none, else show it large. */
  onPhoto: () => void;
  onEdit: (focus?: BillField) => void;
};

/**
 * The "Bill details" card at the top of Add / Edit receipt (owner's pick,
 * 2026-11-20, from Splitwise's bill screen): the receipt's photo, who was
 * paid and the total, then subtotal, fees, tax and tip, then the total again. It is
 * read-only — the pencil (or "+ Add tip") opens the edit screen
 * (BillDetailsEdit), so the form itself stays short: this card, the category
 * and a note.
 */
export default function BillCard({ merchant, date, total, subtotal, fees, tax, tip, receiptUrl, lost, uploading, note, noteTone, viewingLarge, warnings = [], onPhoto, onEdit }: Props) {
  const day = dayLabel(date);
  const totalText = money(total);
  const blank = !merchant.trim() && !totalText;
  const sub = uploading ? 'Uploading…'
    : blank ? (receiptUrl || lost ? 'Tap the pencil to type the details' : 'Take a photo of the receipt')
      : [totalText, day].filter(Boolean).join(' · ');

  return (
    <div className="ccr-bill">
      <div className="ccr-bill-head">
        <button type="button" className="ccr-bill-thumb" onClick={onPhoto} disabled={uploading}
          aria-label={receiptUrl ? (isPdfUrl(receiptUrl) ? 'View the PDF receipt large' : 'View the receipt large') : 'Take a photo or choose a file'}
          aria-expanded={receiptUrl ? viewingLarge : undefined}>
          {receiptUrl
            ? (isPdfUrl(receiptUrl) ? <span className="ccr-bill-pdf">PDF</span> : <img src={receiptUrl} alt="" />)
            : (lost ? <FileText size={22} aria-hidden="true" /> : <Camera size={22} aria-hidden="true" />)}
        </button>
        <div className="ccr-bill-who">
          <div className={`ccr-bill-name${merchant.trim() ? '' : ' is-empty'}`}>{merchant.trim() || 'Receipt details'}</div>
          <div className="ccr-bill-sub">{sub}</div>
        </div>
        <button type="button" className="ccr-bill-edit" onClick={() => onEdit()} aria-label="Edit bill details" disabled={uploading}>
          <Pencil size={18} aria-hidden="true" />
        </button>
      </div>

      <dl className="ccr-bill-rows">
        <div><dt>Subtotal</dt><dd>{money(subtotal) || '—'}</dd></div>
        {money(fees) ? <div><dt>Fees</dt><dd>{money(fees)}</dd></div> : null}
        <div><dt>Tax</dt><dd>{money(tax) || '—'}</dd></div>
        {money(tip) ? <div><dt>Tip</dt><dd>{money(tip)}</dd></div> : null}
      </dl>
      {!money(tip) ? (
        <button type="button" className="ccr-bill-addtip" onClick={() => onEdit('tip')} disabled={uploading}>
          <Plus size={16} aria-hidden="true" /> Add tip
        </button>
      ) : null}

      <div className="ccr-bill-total"><span>Total</span><strong>{totalText || '—'}</strong></div>
      {note ? <p className={`ccr-bill-note${noteTone === 'check' ? ' is-check' : ''}`} aria-live="polite">{note}</p> : null}
      <WarnLines lines={warnings} />
    </div>
  );
}
