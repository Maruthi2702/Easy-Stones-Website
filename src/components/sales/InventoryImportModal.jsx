import React, { useState } from 'react';
import { X, Upload, AlertCircle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';

const toInputDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};

const InventoryImportModal = ({ type, onClose, onComplete }) => {
  const isSales = type === 'sales';
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [location, setLocation] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const handleFileSelect = async (e) => {
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
      const endpoint = isSales ? 'sales' : 'stock';
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
      const body = new FormData();
      body.append('file', file);
      if (isSales) {
        body.append('location', location.trim());
        body.append('periodStart', periodStart);
        body.append('periodEnd', periodEnd);
      }
      const endpoint = isSales ? 'sales' : 'stock';
      const res = await authFetch(`${API_URL}/api/inventory-analysis/import/${endpoint}/apply`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Import failed');
        return;
      }
      onComplete();
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
              <h3>{isSales ? 'Import Sales History' : 'Import Inventory Stock'}</h3>
              <p className="invan-modal-sub-text">
                {isSales
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
          {!isSales && (
            <div className="invan-modal-warning-banner">
              <AlertCircle size={16} />
              <span>Importing replaces <strong>all</strong> current inventory stock data with this file's snapshot.</span>
            </div>
          )}

          {error && <div className="invan-modal-error-banner"><AlertCircle size={18} /> {error}</div>}

          <div className="invan-form-group">
            <label>Export File (.xlsx or .xls) <span className="invan-req-star">*</span></label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFileSelect} className="invan-file-input" />
          </div>

          {loading && <div className="invan-modal-loading">Reading file...</div>}

          {preview && (
            <>
              <div className="invan-preview-summary">
                <CheckCircle2 size={16} />
                <span>{preview.totalRows} row{preview.totalRows === 1 ? '' : 's'} found and ready to import.</span>
              </div>

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
                    <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="invan-text-input" />
                  </div>
                  <div className="invan-form-group">
                    <label>Period End <span className="invan-req-star">*</span></label>
                    <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="invan-text-input" />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="invan-modal-footer">
            <button type="button" className="invan-btn-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="invan-btn-save" onClick={handleApply} disabled={!preview || applying}>
              <Upload size={18} />
              <span>{applying ? 'Importing...' : isSales ? 'Import Sales History' : 'Replace Inventory Data'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryImportModal;
