import { useState } from 'react';
import './PurchasingOverviewPreview.css';

// Design fixtures only. Never connected to the live workbench or its API.
// Uniform 75 SF slabs make physical counts equal slab equivalents in this demo.
const rows = [
  { name: 'Enigma SJ MQ 3CM', total: 40, allocated: 28, excluded: 2, available: 10, daily: 2, incoming: 52, containers: 1, arrivalDays: 45, po: 'DEMO-101', container: 'DEMO-C1' },
  { name: 'Carrara Prima Select 3CM', total: 150, allocated: 24, excluded: 6, available: 120, daily: 2, incoming: 52, containers: 1, arrivalDays: 31, po: 'DEMO-102', container: 'DEMO-C2' },
  { name: 'Olympic SJ MQ 2CM', total: 320, allocated: 20, excluded: 0, available: 300, daily: 2, incoming: 0, containers: 0, arrivalDays: 0, po: '', container: '' },
];
const count = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const anchor = '2026-10-25';
const date = (days: number) => {
  const value = new Date(`${anchor}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
export default function PurchasingOverviewPreview() {
  const [days, setDays] = useState('10');
  const [search, setSearch] = useState('');
  const [dark, setDark] = useState(false);
  const horizon = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 365 ? Number(days) : null;
  return <main className="pov">
    <div className="pov-demo"><span>Design preview · illustrative data · not live SPS stock</span><button onClick={() => {
      document.body.classList.toggle('light-theme-active', dark); setDark(!dark);
    }}>{dark ? 'Light theme' : 'Dark theme'}</button></div>
    <header className="pov-heading"><div><p className="pov-eyebrow">INVENTORY / PURCHASING</p><h1>Know what you have. Know when to buy.</h1><p>Seattle · Sample stock and sales through October 25, 2026</p></div><button className="pov-primary" onClick={() => window.print()}>Print review</button></header>
    <div className="pov-notice">Stock cover uses <strong>available stock only</strong>. Incoming supply is shown separately. Sales pace in this example: 2 slab equivalents/day, based on 75 SF slabs.</div>
    <section className="pov-panel" aria-label="Purchasing stock overview">
      <div className="pov-toolbar"><input aria-label="Search color" placeholder="Search color or variant…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="pov-horizon"><label htmlFor="pov-days">Plan for</label><input id="pov-days" inputMode="numeric" type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} aria-invalid={horizon === null} /><span>days</span></div>
        <div className="pov-presets" aria-label="Planning day presets">{[1, 2, 4, 5, 10, 30, 60, 90].map(n => <button key={n} aria-pressed={horizon === n} onClick={() => setDays(String(n))}>{n}d</button>)}</div>
      </div>
      {horizon === null && <p role="alert" className="pov-validation">Enter a whole number from 1 to 365 days.</p>}
      <div className="pov-scroll"><table><thead><tr><th>Color & variant</th><th>Total SPS slabs</th><th>Allocated</th><th>Available to sell</th><th>In-transit containers</th><th>Stock lasts</th><th>{horizon ? `After ${horizon} days` : 'Projected stock'}</th><th>Next action</th></tr></thead>
      <tbody>{rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase())).map(r => {
        const cover = r.available / r.daily;
        const balance = horizon === null ? null : r.available - r.daily * horizon;
        const gap = r.incoming > 0 && r.arrivalDays > cover;
        const buy = (lead: number) => Math.ceil(Math.max(0, r.daily * (lead + 7 + 21) - r.available - r.incoming) / 6) * 6;
        const receipt = Math.max(0, Math.floor(cover - 21));
        return <tr key={r.name}><td><strong>{r.name}</strong><small>Seattle · full slabs</small><details><summary>View buying calculation</summary><div className="pov-detail"><p>Average sales: {r.daily} slab equivalents/day (150 SF/day).</p><p>Suggested buy, 60-day delivery: <strong>{count(buy(60))} slabs</strong></p><p>Suggested buy, 90-day delivery: <strong>{count(buy(90))} slabs</strong></p><p>Assumes 7 review days, 21 buffer days, 6-slab bundles and the example's confirmed incoming supply. Earlier shortages still require an expedite/transfer review.</p><p>Safety-buffer threshold from current stock: <strong>{date(receipt)}</strong>. This is separate from stockout.</p></div></details></td>
          <td><strong>{r.total}</strong><small>On hand in SPS</small></td>
          <td><strong>{r.allocated}</strong><small>Sales orders / holds</small><small>{r.excluded} other unavailable</small></td>
          <td><strong className="pov-quantity">{r.available}</strong><small>Free to sell now</small></td>
          <td>{r.incoming ? <><strong>{r.incoming} slabs · {r.containers} container</strong><small>Expected {date(r.arrivalDays)}</small><details><summary>PO & container details</summary><div className="pov-detail"><p>PO {r.po} · {r.container}</p><p>52 slabs for this color · Seattle</p><p>Sample usable receipt confirmed: {date(r.arrivalDays)}</p></div></details></> : <><strong>0</strong><small>Complete supply report</small></>}</td>
          <td><strong className={`pov-cover ${cover <= 10 ? 'pov-danger' : ''}`}>{count(cover)} days</strong><small>At current sales pace</small><small>Stockout around {date(Math.ceil(cover))}</small></td>
          <td>{balance === null ? '—' : <><strong className={balance < 0 ? 'pov-danger' : ''}>{balance < 0 ? `${count(-balance)} short` : `${count(balance)} left`}</strong><small>Slab equivalents · current stock</small></>}</td>
          <td><span className={`pov-badge ${gap ? 'pov-urgent' : ''}`}>{gap ? 'Expedite / transfer' : buy(90) > 0 ? 'Review replenishment' : 'Stock sufficient'}</span><small>{gap ? `Stock runs out before the ${date(r.arrivalDays)} arrival.` : buy(90) > 0 ? 'Check delivery time and buying details.' : 'No new buy in the 90-day lead-time case.'}</small></td></tr>;
      })}</tbody></table></div>
      {!rows.some(r => r.name.toLowerCase().includes(search.toLowerCase())) && <p className="pov-empty">No colors match your search.</p>}
      <p className="pov-footnote">Total SPS slabs = allocated + other unavailable + available. Overlapping commitments count once. Forecast balances use slab equivalents; physical slab sizes can differ in actual reports.</p>
    </section>
    <p className="pov-footer">A reported ETA does not confirm a usable receipt. Missing or invalid sales data displays “Coverage unknown” instead of a guessed day count.</p>
  </main>;
}
