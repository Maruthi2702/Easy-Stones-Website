import React, { useState } from 'react';
import { X, Upload, AlertCircle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import type { InventoryImportKind, InventoryImportResult, TransitLine } from '../../types/inventory';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { DatePicker } from '../shared/calendar/Calendar';

const toInputDate = (d: string | null | undefined) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};

interface ImportPreview {
  uploadId?: string;
  totalRows: number;
  shipmentCount?: number;
  sample: TransitLine<string>[];
  detected?: { location?: string; periodStart?: string; periodEnd?: string };
}
interface InventoryImportModalProps {
  type: InventoryImportKind;
  onClose: () => void;
  onComplete: (result: InventoryImportResult) => void;
}

const InventoryImportModal = ({ type, onClose, onComplete }: InventoryImportModalProps) => {
  const isSales = type === 'sales';
  const isTransit = type === 'transit';
  const endpoint = isTransit ? 'transit' : isSales ? 'sales' : 'stock';
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [location, setLocation] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setError('');
    // Clear any values left over from a previously-selected file — otherwise
    // picking the wrong file, noticing, and re-picking the right one keeps
    // the earlier file's location/period in these fields whenever the new
    // file's title doesn't parse its own (e.g. a binary .xls with no HTML
    // title), silently mislabeling this import under the stale values.
    setLocation('');
    setPeriodStart('');
    setPeriodEnd('');
    setLoading(true);
    try {
      const body = new FormData();
      body.append('file', selected);
      const res = await authFetch(`${API_URL}/api/inventory-analysis/import/${endpoint}/preview`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to read file');
        return;
      }
      if (data.missingRequired?.length) {
        setError(`This file is missing expected column(s): ${data.missingRequired.join(', ')}. Check you exported the right report.`);
        return;
      }
      if (data.errors?.length) {
        setError(data.errors.slice(0, 5).join('; '));
        return;
      }
      if (!data.totalRows) {
        setError('No matching product rows found. Check the report type and status.');
        return;
      }
      setPreview(data);
      if (isSales && data.detected) {
        if (data.detected.location) setLocation(data.detected.location);
        if (data.detected.periodStart) setPeriodStart(toInputDate(data.detected.periodStart));
        if (data.detected.periodEnd) setPeriodEnd(toInputDate(data.detected.periodEnd));
      }
    } catch (err) {
      console.error('Error previewing inventory import:', err);
      setError('Network error while reading file');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!file || !preview) return;
    if (isSales && (!location.trim() || !periodStart || !periodEnd)) {
      setError('Location, period start, and period end are required.');
      return;
    }
    setApplying(true);
    setError('');
    try {
      // The server kept the file it parsed for the preview, so Import sends
      // only its id instead of uploading the whole file (~12 MB for a stock
      // export) a second time. If that copy has gone (it lasts 10 minutes, and
      // not past a server restart), the server answers 410 and the file is
      // sent after all.
      const send = (withFile: boolean) => {
        const body = new FormData();
        if (withFile || !preview.uploadId) body.append('file', file);
        else body.append('uploadId', preview.uploadId);
        if (isSales) {
          body.append('location', location.trim());
          body.append('periodStart', periodStart);
          body.append('periodEnd', periodEnd);
        }
        return authFetch(`${API_URL}/api/inventory-analysis/import/${endpoint}/apply`, { method: 'POST', body });
      };
      let res = await send(false);
      if (res.status === 410 && preview.uploadId) res = await send(true);
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Import failed');
        return;
      }
      onComplete(data);
    } catch (err) {
      console.error('Error applying inventory import:', err);
      setError('Network error while importing file');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="invan-modal-overlay anim-fade-in" onClick={onClose}>
      <div className="invan-modal-content anim-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="invan-modal-header">
          <div className="invan-modal-title-wrap">
            <div className="invan-modal-icon-badge">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h3>{isTransit ? 'Import In-Transit Containers' : isSales ? 'Import Sales History' : 'Import Inventory Stock'}</h3>
              <p className="invan-modal-sub-text">
                {isTransit ? 'Upload the SPS in-transit report with PO# and Container# columns' : isSales
                  ? 'Upload SPS\'s "Fast Moving Inventory" export for a location and date range'
                  : 'Upload SPS\'s "Inventory In Stock - Detail" export'}
              </p>
            </div>
          </div>
          <button type="button" className="invan-modal-close-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="invan-modal-form">
          {!isSales && !isTransit && (
            <div className="invan-modal-warning-banner">
              <AlertCircle size={16} />
              <span>Importing replaces <strong>all</strong> current inventory stock data with this file's snapshot.</span>
            </div>
          )}

          {isTransit && <p>Updates the shipments in this file by PO, container and branch. Shipments absent from this file are kept.</p>}

          {error && <div className="invan-modal-error-banner"><AlertCircle size={18} /> {error}</div>}

          <div className="invan-form-group">
            <label>Export File ({isTransit ? '.xlsx, .xls, .csv or .txt' : '.xlsx or .xls'}) <span className="invan-req-star">*</span></label>
            <input type="file" accept={isTransit ? ".xlsx,.xls,.csv,.txt" : ".xlsx,.xls"} onChange={handleFileSelect} className="invan-file-input" />
          </div>

          {loading && <div className="invan-modal-loading">Reading file...</div>}

          {preview && (
            <>
              <div className="invan-preview-summary">
                <CheckCircle2 size={16} />
                <span>{preview.totalRows} row{preview.totalRows === 1 ? '' : 's'} found{isTransit ? ` across ${preview.shipmentCount} shipments` : ''} and ready to import.</span>
              </div>

              {isTransit && (
                <div className="invan-grid-wrapper">
                  <table className="invan-table">
                    <thead><tr><th>PO#</th><th>Container#</th><th>Product</th><th>Slabs</th><th>Quantity</th><th>Branch</th><th>ETA</th></tr></thead>
                    <tbody>{preview.sample.map((row, i) => <tr key={i}>
                      <td>{row.poNumber}</td><td>{row.containerNumber}</td><td>{row.product}</td><td>{row.slabs}</td>
                      <td>{row.quantity} {row.units}</td><td>{row.location}</td><td>{toInputDate(row.etaDate) || 'Unknown'}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}

              {isSales && (
                <div className="invan-form-grid-3col">
                  <div className="invan-form-group">
                    <label>Location <span className="invan-req-star">*</span></label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Seattle"
                      className="invan-text-input"
                    />
                  </div>
                  <div className="invan-form-group">
                    <label>Period Start <span className="invan-req-star">*</span></label>
                    <DatePicker value={periodStart} onChange={setPeriodStart} sheetTitle="Period start" ariaLabel="Period start" />
                  </div>
                  <div className="invan-form-group">
                    <label>Period End <span className="invan-req-star">*</span></label>
                    <DatePicker value={periodEnd} onChange={setPeriodEnd} sheetTitle="Period end" ariaLabel="Period end" />
                  </div>
                </div>
              )}
            </>
          )}

          {applying && (
            <div className="invan-modal-loading">
              {isTransit ? 'Saving PO and container details...' : isSales
                ? 'Importing... this can take a little while for a large report.'
                : 'Importing... a full catalog snapshot can take up to a minute. Please don\'t close this window.'}
            </div>
          )}

          <div className="invan-modal-footer">
            <button type="button" className="invan-btn-cancel" onClick={onClose} disabled={applying}>Cancel</button>
            <button type="button" className="invan-btn-save" onClick={handleApply} disabled={!preview || applying}>
              <Upload size={18} />
              <span>{applying ? 'Importing...' : isTransit ? 'Import Containers' : isSales ? 'Import Sales History' : 'Replace Inventory Data'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryImportModal;
