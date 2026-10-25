import { useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { X, ScanBarcode, Lock } from 'lucide-react';
import { FormSearchPicker } from '../../../components/shared/form/FormControls';
import { formatSf } from '../../../holds/holdRules';
import { cartActions } from '../cartStore';
import type { Cart } from '../types';
import { groupsOf, usable } from './cartLines';
import type { CustomerChoice, LotGroup, ShownLine } from './cartLines';
import { LotBadge, NoteInput } from './CartLineParts';

export type CartViewProps = {
  cart: Cart;
  lines: ShownLine[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  expanded: boolean;
  customers: CustomerChoice[];
  customersLoading: boolean;
};

/** The cart itself: who it's for, the scan box, and the slabs by product with their ticks. */
export default function CartView({ cart, lines, selected, setSelected, expanded, customers, customersLoading }: CartViewProps) {
  const [code, setCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const groups = groupsOf(lines);

  const toggle = (key: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleGroup = (group: LotGroup) => setSelected((s) => {
    const keys = group.lines.filter(usable).map((l) => l.slabKey);
    const allOn = keys.every((k) => s.has(k));
    const next = new Set(s);
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
    return next;
  });

  const scan = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = code.trim();
    if (!value || scanning) return;
    setScanning(true);
    try {
      const res = await cartActions.scan(value);
      if (res.added.length) setScanMsg({ ok: true, text: `${res.added[0]} added · ${res.slab?.product || ''}` });
      else setScanMsg({ ok: false, text: `${res.skipped[0]?.slabKey}: ${res.skipped[0]?.reason}` });
      setCode('');
    } catch (err) {
      setScanMsg({ ok: false, text: (err as Error).message });
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  };

  return (
    <>
      <div className="cd-for">
        <span className="cd-for-label">For</span>
        <div className="cd-for-picker">
          <FormSearchPicker
            id="cart-customer"
            value={cart.customer?.id || ''}
            onChange={(v: string) => cartActions.setCustomer(v, customers.find((o) => o.value === v)?.label || '')}
            options={customers}
            loading={customersLoading && customers.length === 0}
            selectedLabel={cart.customer?.name || ''}
            placeholder="Customer (optional)"
            sheetTitle="Customer"
          />
        </div>
        {cart.customer && (
          <button type="button" className="cd-link" onClick={() => cartActions.setCustomer(null)}>Clear</button>
        )}
      </div>

      <form className="cd-scan" onSubmit={scan}>
        <label className="cd-scan-box">
          <ScanBarcode size={18} aria-hidden="true" />
          <input
            ref={scanRef}
            value={code}
            onChange={(e) => { setCode(e.target.value); setScanMsg(null); }}
            placeholder="Scan or type barcode / serial #"
            aria-label="Scan or type a barcode or serial number"
            autoComplete="off"
            enterKeyHint="done"
          />
        </label>
        <button type="submit" className="fm-btn" disabled={!code.trim() || scanning}>Add</button>
      </form>
      {scanMsg && <div role="status" className={`cd-scan-msg ${scanMsg.ok ? 'ok' : 'bad'}`}>{scanMsg.text}</div>}

      {!lines.length && (
        <div className="cd-empty">
          <b>Your cart is empty</b>
          <span>Tick slabs on the Inventory screen, or scan a slab’s barcode above.</span>
        </div>
      )}

      {groups.map((group) => {
        const keys = group.lines.filter(usable).map((l) => l.slabKey);
        const allOn = keys.length > 0 && keys.every((k) => selected.has(k));
        return (
          <section key={group.product} className="cd-group" aria-label={group.product}>
            <div className="cd-group-head">
              <input
                type="checkbox"
                className="cd-chk"
                checked={allOn}
                disabled={!keys.length}
                onChange={() => toggleGroup(group)}
                aria-label={`Select all ${group.product}`}
              />
              <div className="cd-group-name">
                <b>{group.product}</b>
                <span>{group.slabs} slab{group.slabs === 1 ? '' : 's'} · {formatSf(group.sfHundredths)}</span>
              </div>
            </div>
            <LotBadge group={group} />
            {expanded && (
              <div className="cd-row cd-row-head" aria-hidden="true">
                <span /><span>Serial #</span><span>Barcode</span><span>Bundle</span><span>Slab · block</span><span>Bin</span><span>Size</span><span>Note for this slab</span><span />
              </div>
            )}
            {group.lines.map((line) => {
              const dead = !usable(line);
              return (
                <div key={line.slabKey} className={`cd-row${dead ? ' is-dead' : ''}`}>
                  <input
                    type="checkbox"
                    className="cd-chk"
                    checked={!dead && selected.has(line.slabKey)}
                    disabled={dead}
                    onChange={() => toggle(line.slabKey)}
                    aria-label={`Use ${line.slabKey}`}
                  />
                  <div className="cd-slab">
                    <b className="cd-serial">{line.serial || line.slabKey}</b>
                    {line.lock && <span className="cd-tag cd-tag-lock"><Lock size={11} aria-hidden="true" />On Hold #{line.lock.holdNumber}{line.lock.by ? ` · ${line.lock.by}` : ''}</span>}
                    {!line.inStock && <span className="cd-tag cd-tag-lock">No longer in stock</span>}
                    {!dead && (line.othersInCart?.length ?? 0) > 0 && <span className="cd-tag cd-tag-others">{line.othersInCart.join(', ')} {line.othersInCart.length === 1 ? 'has' : 'have'} it in a cart</span>}
                    {!expanded && line.inStock && (
                      <span className="cd-sub">{[line.dimensions, formatSf(line.sfHundredths), line.bin && `bin ${line.bin}`].filter(Boolean).join(' · ')}{line.note ? ` · “${line.note}”` : ''}</span>
                    )}
                  </div>
                  {expanded && (
                    <>
                      <span className="cd-cell">{line.barcode || '—'}</span>
                      <span className="cd-cell">{line.bundle || '—'}</span>
                      <span className="cd-cell">{[line.slabNumber, line.block].filter(Boolean).join(' · ') || '—'}</span>
                      <span className="cd-cell">{line.bin || '—'}</span>
                      <span className="cd-cell">{line.dimensions ? `${line.dimensions} · ` : ''}{formatSf(line.sfHundredths)}</span>
                      <NoteInput line={line} />
                    </>
                  )}
                  <button type="button" className="cd-remove" onClick={() => cartActions.remove(line.slabKey)} aria-label={`Remove ${line.slabKey}`}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
