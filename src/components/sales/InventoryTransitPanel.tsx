import React, { useEffect, useState } from 'react';
import type { TransitShipmentResponse } from '../../types/inventory';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import Pagination from '../shared/Pagination';
import { usePagination } from '../shared/paginationConfig';
import { fmtNum } from './inventoryFormat';

const date = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' }) : 'Unknown';

interface InventoryTransitPanelProps {
  refreshSignal: string | number;
  canImport: boolean;
  onImport: () => void;
}

export default function InventoryTransitPanel({ refreshSignal, canImport, onImport }: InventoryTransitPanelProps) {
  const [shipments, setShipments] = useState<TransitShipmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const response = await authFetch(`${API_URL}/api/inventory-analysis/in-transit`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to load containers');
        if (active) setShipments(data.shipments || []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load containers');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshSignal, retry]);

  const query = search.trim().toLowerCase();
  const rows = shipments.flatMap(shipment => shipment.lines.map((line, index) => ({
    ...line, id: `${shipment._id}-${index}`, importedAt: shipment.importedAt
  }))).filter(row => [row.poNumber, row.containerNumber, row.product, row.location, row.supplier]
    .some(value => String(value || '').toLowerCase().includes(query)));
  const pages = Math.ceil(rows.length / rowsPerPage) || 1;
  const page = Math.min(currentPage, pages);
  const latest = shipments.reduce((last, shipment) => shipment.importedAt > last ? shipment.importedAt : last, '');

  return <section className="invan-transit-panel">
    <div className="invan-header">
      <div><h3>In-Transit Containers</h3><p>Incoming products by PO and container. Quantities are separate from stock on hand.</p></div>
      <button type="button" className="invan-btn-import secondary" onClick={() => setRetry(value => value + 1)}>Refresh</button>
    </div>
    {latest && <p className="invan-subtitle">Last container import: {new Date(latest).toLocaleString()}</p>}
    <div className="invan-search-box">
      <input aria-label="Search in-transit containers" placeholder="Search PO#, container, product, branch or supplier" value={search}
        onChange={event => { setSearch(event.target.value); resetPage(); }} />
    </div>
    {error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading containers...</p> : !shipments.length ?
      <div className="invan-empty-state"><h4>No In-Transit Containers Yet</h4>
        <p>Upload the SPS in-transit export to see PO numbers, products, quantities and arrival dates.</p>
        {canImport && <button type="button" className="invan-btn-import" onClick={onImport}>Import In-Transit</button>}
      </div> : <>
        <p>{rows.length} product lines · {new Set(rows.map(row => JSON.stringify([row.poNumber, row.containerNumber, row.location]))).size} shipments</p>
        <div className="invan-grid-wrapper invan-transit-grid">
          <table className="invan-table">
            <thead><tr><th>PO#</th><th>Container#</th><th>Product / Shipment details</th><th>Slabs</th><th>Quantity</th><th>Branch</th><th>ETA</th><th>Status</th></tr></thead>
            <tbody>{rows.slice((page - 1) * rowsPerPage, page * rowsPerPage).map(row => <tr key={row.id}>
              <td><strong>{row.poNumber}</strong></td><td>{row.containerNumber}</td>
              <td>{row.product}<details><summary>Shipment details</summary>
                <dl><dt>Supplier</dt><dd>{row.supplier || '—'}</dd>
                  <dt>PO date</dt><dd>{date(row.poDate)}</dd><dt>PO ETA</dt><dd>{date(row.poEtaDate)}</dd>
                  <dt>Supplier SO# / SIPL#</dt><dd>{row.supplierSoNumber || '—'} / {row.siplNumber || '—'}</dd>
                  <dt>Ship date</dt><dd>{date(row.shipDate)}</dd><dt>Port ETA</dt><dd>{date(row.portEtaDate)}</dd>
                  <dt>Forwarder / Vessel</dt><dd>{row.freightForwarder || '—'} / {row.vessel || '—'}</dd>
                  <dt>Supplier / purchase note</dt><dd>{row.supplierPurchaseNote || '—'}</dd>
                  <dt>SKU / Reference</dt><dd>{row.sku || '—'} / {row.customerReference || '—'}</dd>
                </dl></details></td>
              <td>{fmtNum(row.slabs)}</td><td>{fmtNum(row.quantity)} {row.units}</td><td>{row.location}</td>
              <td>{date(row.etaDate)}{row.etaDate && new Date(row.etaDate).toISOString().slice(0, 10) < new Date().toLocaleDateString('en-CA') && <small> · Past ETA</small>}</td>
              <td>{row.status}</td>
            </tr>)}</tbody>
          </table>
          {!rows.length && <p>No matching containers.</p>}
        </div>
        <Pagination currentPage={page} totalPages={pages} onPageChange={setCurrentPage}
          rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={rows.length} />
      </>}
  </section>;
}
