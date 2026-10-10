import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { SLAB_STATUS_BUCKET as statusBucket } from '../../utils/inventoryStatus';
import { fmtMoney, fmtNum, fmtRate, ageDays, STATUS_LABEL } from './inventoryFormat';
import { slabKeyOf, isHoldableSlab } from '../../holds/holdRules';
import { useCart, cartActions } from './holds/cartStore';
import useSlabLocks from './holds/useSlabLocks';

/**
 * One product's slabs on the Inventory screen (moved out of
 * InventoryAnalysisTab.jsx, 2026-10-10). Grouped by bundle, block or location
 * with a summary row per group (SPS's "Expand All" layout, approved on the
 * Inventory & Cart canvas), and — for people with the Use cart permission —
 * a cart checkbox on the right of every whole slab. A slab on a hold shows
 * the hold instead.
 */

const GROUPINGS = [
  { value: 'bundle', label: 'Bundle' },
  { value: 'block', label: 'Block' },
  { value: 'location', label: 'Location' },
  { value: 'none', label: 'None' }
];
const GROUP_KEY = 'invan-slab-grouping';

const readGrouping = () => {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return GROUPINGS.some((g) => g.value === v) ? v : 'bundle';
  } catch {
    return 'bundle';
  }
};

export default function InventorySlabList({ items, total, canViewPrices, canUseCart }) {
  const [grouping, setGrouping] = useState(readGrouping);
  const { cart } = useCart();
  const inCart = useMemo(() => new Set(cart.lines.map((l) => l.slabKey)), [cart.lines]);
  const holdableKeys = useMemo(() => items.filter(isHoldableSlab).map((s) => slabKeyOf(s.serialNumber)), [items]);
  const locks = useSlabLocks(canUseCart ? holdableKeys : []);

  const pickGrouping = (value) => {
    setGrouping(value);
    try { localStorage.setItem(GROUP_KEY, value); } catch { /* remembered for this visit only */ }
  };

  const groups = useMemo(() => {
    if (grouping === 'none') return [{ key: '', items }];
    const map = new Map();
    for (const s of items) {
      const k = String(s[grouping] || '').trim() || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return [...map].map(([key, list]) => ({ key, items: list }));
  }, [items, grouping]);

  const rowClass = `${canViewPrices ? '' : ' no-price'}${canUseCart ? ' has-cart' : ''}`;

  const toggleSlab = (key) => (inCart.has(key) ? cartActions.remove(key) : cartActions.add([key]));
  const freeKeysOf = (list) => list.filter(isHoldableSlab).map((s) => slabKeyOf(s.serialNumber)).filter((k) => !locks[k]);
  const toggleGroup = (list) => {
    const keys = freeKeysOf(list);
    const missing = keys.filter((k) => !inCart.has(k));
    if (missing.length) cartActions.add(missing);
    else keys.forEach((k) => cartActions.remove(k, { silent: true }));
  };

  const cartCell = (s) => {
    if (!canUseCart) return null;
    const key = slabKeyOf(s.serialNumber);
    if (!isHoldableSlab(s)) return <span className="sa-cart" />;
    const lock = locks[key];
    if (lock) {
      return (
        <span className="sa-cart">
          <span className="invan-cart-lock" title={`On Hold #${lock.holdNumber}${lock.by ? ` · ${lock.by}` : ''}${lock.expiresOn ? ` · until ${lock.expiresOn}` : ''}`}>
            <Lock size={11} aria-hidden="true" />#{lock.holdNumber}
          </span>
        </span>
      );
    }
    return (
      <span className="sa-cart">
        <input
          type="checkbox"
          className="invan-cart-chk"
          checked={inCart.has(key)}
          onChange={() => toggleSlab(key)}
          aria-label={inCart.has(key) ? `${s.serialNumber} is in your cart` : `Add ${s.serialNumber} to cart`}
        />
      </span>
    );
  };

  return (
    <div className="invan-slabs">
      <div className="invan-slab-tools">
        <span>Group slabs by</span>
        <div className="invan-seg" role="group" aria-label="Group slabs by">
          {GROUPINGS.map((g) => (
            <button key={g.value} type="button" className={grouping === g.value ? 'on' : ''} aria-pressed={grouping === g.value} onClick={() => pickGrouping(g.value)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`invan-slab-head desktop-only${rowClass}`}>
        <span className="sa-sp"></span>
        <span className="sa-serial">Serial#</span>
        <span className="sa-dims">Dimensions</span>
        <span className="sa-loc">Location</span>
        <span className="sa-onhand">On Hand</span>
        {canViewPrices && <span className="sa-landed">Landed Cost</span>}
        <span className="sa-recv">Received</span>
        <span className="sa-age">Age</span>
        <span className="sa-status">Status</span>
        {canUseCart && <span className="sa-cart">Cart</span>}
      </div>

      {groups.map((group) => {
        const free = freeKeysOf(group.items);
        const allIn = free.length > 0 && free.every((k) => inCart.has(k));
        const sf = group.items.reduce((sum, s) => sum + Number(s.instockQty || 0), 0);
        return (
          <div key={group.key || 'all'} className="invan-slab-group">
            {grouping !== 'none' && (
              <div className="invan-bundle-row">
                <span className="invan-bundle-name">{GROUPINGS.find((g) => g.value === grouping)?.label} <b>{group.key}</b></span>
                <span>{group.items.length} slab{group.items.length === 1 ? '' : 's'}</span>
                {canUseCart && <span className={free.length ? 'invan-bundle-free' : 'invan-bundle-none'}>{free.length} free</span>}
                <span>{fmtNum(sf)} SF</span>
                {canUseCart && (
                  <input
                    type="checkbox"
                    className="invan-cart-chk"
                    checked={allIn}
                    disabled={!free.length}
                    onChange={() => toggleGroup(group.items)}
                    aria-label={allIn ? `Remove ${grouping} ${group.key} from cart` : `Add the free slabs of ${grouping} ${group.key} to cart`}
                  />
                )}
              </div>
            )}
            {group.items.map((s) => {
              const sAge = ageDays(s.receivedDate);
              const sBucket = statusBucket(s.slabStatus);
              const mine = canUseCart && inCart.has(slabKeyOf(s.serialNumber));
              return (
                <div key={s._id} className={`invan-slab-row${rowClass}${mine ? ' in-cart' : ''}`}>
                  <span className="sa-sp"></span>
                  <span className="sa-serial invan-slab-serial">{s.serialNumber || '—'}</span>
                  <span className="sa-dims">{s.dimensions || '—'}</span>
                  <span className="sa-loc invan-slab-loc" title={s.location}>{s.location || '—'}</span>
                  <span className="sa-onhand num">{fmtNum(s.instockQty)}<span className="unit">{s.units}</span></span>
                  {/* Rate and slab total in one cell: they're the same
                      fact at two scales, and quoting means reading
                      them together rather than across the row. */}
                  {canViewPrices && (
                    <span className="sa-landed num">
                      {fmtRate(s.unitLandedCost)}<span className="unit">/{s.units || 'ea'}</span>
                      <span className="invan-slab-total">{fmtMoney(s.assetValue)}</span>
                    </span>
                  )}
                  <span className="sa-recv num">{s.receivedDate ? new Date(s.receivedDate).toLocaleDateString() : '—'}</span>
                  <span className={`sa-age num${sAge !== null && sAge > 365 ? ' invan-age-old' : ''}`}>{sAge !== null ? `${sAge}d` : '—'}</span>
                  <span className="sa-status"><span className={`invan-status-pill ${sBucket}`}>{STATUS_LABEL[sBucket]}</span></span>
                  {cartCell(s)}
                </div>
              );
            })}
          </div>
        );
      })}

      {total > items.length && (
        <div className="invan-slabs-status">Showing {items.length} of {total} slabs.</div>
      )}
    </div>
  );
}
