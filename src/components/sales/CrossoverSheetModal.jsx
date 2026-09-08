import React, { useState, useEffect, useCallback } from 'react';
import { X, ArrowLeftRight, Save, AlertCircle, Building2, FileText } from 'lucide-react';
import CustomSelect from '../shared/CustomSelect';

const MATCH_TYPE_OPTIONS = [
  { value: 'Direct Crossover', label: 'Direct Crossover' },
  { value: 'Similar', label: 'Similar' }
];

const CrossoverSheetModal = ({ isOpen, onClose, onSave, initialData = null }) => {
  const [distributorName, setDistributorName] = useState('');
  const [distributorColorName, setDistributorColorName] = useState('');
  const [easyStonesName, setEasyStonesName] = useState('');
  const [matchType, setMatchType] = useState('Similar');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setDistributorName('');
    setDistributorColorName('');
    setEasyStonesName('');
    setMatchType('Similar');
    setNotes('');
    setError('');
  }, []);

  useEffect(() => {
    if (initialData) {
      setDistributorName(initialData.distributorName || '');
      setDistributorColorName(initialData.distributorColorName || '');
      setEasyStonesName(initialData.easyStonesName || '');
      setMatchType(initialData.matchType || 'Similar');
      setNotes(initialData.notes || '');
      setError('');
    } else {
      resetForm();
    }
  }, [initialData, isOpen, resetForm]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!distributorName.trim()) {
      setError('Please enter the distributor company name.');
      return;
    }
    if (!distributorColorName.trim()) {
      setError("Please enter the distributor's color name.");
      return;
    }
    if (!easyStonesName.trim()) {
      setError('Please enter the Easy Stones crossover name.');
      return;
    }

    onSave({
      _id: initialData?._id,
      distributorName: distributorName.trim(),
      distributorColorName: distributorColorName.trim(),
      easyStonesName: easyStonesName.trim(),
      matchType,
      notes: notes.trim()
    });
  };

  if (!isOpen) return null;

  return (
    <div className="xover-modal-overlay anim-fade-in" onClick={onClose}>
      <div className="xover-modal-content anim-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="xover-modal-header">
          <div className="xover-modal-title-wrap">
            <div className="xover-modal-icon-badge">
              <ArrowLeftRight size={20} />
            </div>
            <div>
              <h3>{initialData ? 'Edit Crossover Entry' : 'Add Crossover Entry'}</h3>
              <p className="xover-modal-sub-text">Map a distributor's color to its Easy Stones equivalent</p>
            </div>
          </div>
          <button type="button" className="xover-modal-close-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="xover-modal-form">
          {error && <div className="xover-modal-error-banner"><AlertCircle size={18} /> {error}</div>}

          <div className="xover-form-group">
            <label>
              <Building2 size={14} /> Distributor Company Name <span className="xover-req-star">*</span>
            </label>
            <input
              type="text"
              value={distributorName}
              onChange={(e) => setDistributorName(e.target.value)}
              placeholder="e.g. MSI, Arizona Tile, Bedrosians"
              className="xover-text-input"
              autoFocus
            />
          </div>

          <div className="xover-form-grid-2col">
            <div className="xover-form-group">
              <label>
                Distributor Color Name <span className="xover-req-star">*</span>
              </label>
              <input
                type="text"
                value={distributorColorName}
                onChange={(e) => setDistributorColorName(e.target.value)}
                placeholder="e.g. Calacatta Miraggio"
                className="xover-text-input"
              />
            </div>

            <div className="xover-form-group">
              <label>
                Easy Stones Crossover Name <span className="xover-req-star">*</span>
              </label>
              <input
                type="text"
                value={easyStonesName}
                onChange={(e) => setEasyStonesName(e.target.value)}
                placeholder="e.g. Calacatta Mia"
                className="xover-text-input"
              />
            </div>
          </div>

          <div className="xover-form-group">
            <label>Match Type <span className="xover-req-star">*</span></label>
            <CustomSelect
              value={matchType}
              onChange={(e) => setMatchType(e.target.value)}
              options={MATCH_TYPE_OPTIONS}
            />
          </div>

          <div className="xover-form-group">
            <label>
              <FileText size={14} /> Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Veining differences, finish notes, availability caveats..."
              rows={3}
              className="xover-textarea-input"
            />
          </div>

          <div className="xover-modal-footer">
            <button type="button" className="xover-btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="xover-btn-save">
              <Save size={18} />
              <span>{initialData ? 'Update Entry' : 'Save Entry'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CrossoverSheetModal;
