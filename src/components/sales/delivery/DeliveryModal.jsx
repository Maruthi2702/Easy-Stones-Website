import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, Calendar, Clock, MapPin, User, Truck, FileText, AlertCircle, AlertTriangle } from 'lucide-react';
import SearchableSelect from '../../SearchableSelect';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';

const TIME_SLOTS = [
  '08:00 AM', '08:30 AM', '09:00 AM', '09:30 AM',
  '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM',
  '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM',
  '04:00 PM', '04:30 PM', '05:00 PM'
];

const DeliveryModal = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialData = null,
  trucks = [],
  deliveries = [],      // ← used to compute capacity per driver/date
  customerOptions = [],
  currentUser = null
}) => {
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [address, setAddress] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('09:00 AM');
  const [truckId, setTruckId] = useState(trucks[0]?.id || '');
  const [salesRepName, setSalesRepName] = useState(currentUser?.name || '');
  const [status, setStatus] = useState('scheduled');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Track if form has been changed from initialData
  const initialSnapshot = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmDelete(false);
      setError('');
      setIsDirty(false);
      if (initialData) {
        setCustomerName(initialData.customerName || '');
        setSelectedCustomerId(initialData.customerId || '');
        setAddress(initialData.address || '');
        setDate(initialData.date || new Date().toISOString().split('T')[0]);
        setTime(initialData.time || '09:00 AM');
        setTruckId(initialData.truckId || trucks[0]?.id || '');
        setSalesRepName(initialData.salesRepName || currentUser?.name || '');
        setStatus(initialData.status || 'scheduled');
        setNotes(initialData.notes || '');
        initialSnapshot.current = JSON.stringify(initialData);
      } else {
        resetForm();
        initialSnapshot.current = null;
      }
    }
  }, [initialData, isOpen, trucks, currentUser]);

  const resetForm = () => {
    setCustomerName('');
    setSelectedCustomerId('');
    setAddress('');
    setDate(new Date().toISOString().split('T')[0]);
    setTime('09:00 AM');
    setTruckId(trucks[0]?.id || '');
    setSalesRepName(currentUser?.name || '');
    setStatus('scheduled');
    setNotes('');
    setError('');
    setIsDirty(false);
  };

  const markDirty = () => setIsDirty(true);

  // Compute booked count per truck for the selected date
  const getCapacityForTruck = (trkId) => {
    const booked = deliveries.filter(
      d => d.truckId === trkId && d.date === date && d.id !== initialData?.id
    ).length;
    return booked;
  };

  const handleClose = () => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes. Close anyway?')) return;
    }
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    let finalCustomerName = customerName.trim();
    if (!finalCustomerName && selectedCustomerId) {
      const foundOpt = customerOptions.find(o => o.value === selectedCustomerId);
      if (foundOpt) finalCustomerName = foundOpt.label;
    }

    if (!finalCustomerName) {
      setError('Please select or enter a Customer Name.');
      return;
    }

    if (!address.trim()) {
      setError('Please enter a Delivery Address.');
      return;
    }

    if (!truckId) {
      setError('Please assign a driver/truck.');
      return;
    }

    const payload = {
      id: initialData?.id || `del_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      customerId: selectedCustomerId || null,
      customerName: finalCustomerName,
      address: address.trim(),
      date,
      time,
      truckId,
      salesRepName: salesRepName.trim(),
      status,
      notes: notes.trim(),
      updatedAt: new Date().toISOString()
    };

    onSave(payload);
    onClose();
  };

  const handleDeleteConfirmed = () => {
    if (!initialData?.id) return;
    onDelete(initialData.id);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="manifest-modal-overlay anim-fade-in" onClick={handleClose}>
      <div className="manifest-modal-content anim-scale-in" onClick={(e) => e.stopPropagation()}>

        {/* Modal Header */}
        <div className="manifest-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge gold">
              <Truck size={20} />
            </div>
            <div>
              <h3>{initialData?.id ? 'Edit Delivery Ticket' : 'New Delivery Ticket'}</h3>
              <p className="modal-sub-text">Dispatch &amp; Capacity Scheduling</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={handleClose} title="Close">
            <X size={20} />
          </button>
        </div>

        {/* Inline Delete Confirmation Banner */}
        {confirmDelete && (
          <div className="modal-delete-confirm-banner">
            <AlertTriangle size={18} />
            <span>Delete this delivery? This cannot be undone.</span>
            <div className="delete-confirm-actions">
              <button type="button" className="btn-confirm-delete" onClick={handleDeleteConfirmed}>
                Yes, delete
              </button>
              <button type="button" className="btn-cancel-delete" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="manifest-modal-form">
          {error && <div className="modal-error-banner"><AlertCircle size={18} /> {error}</div>}

          {/* Customer & Address */}
          <div className="form-group-field">
            <label>Customer Name <span className="req-star">*</span></label>
            <SearchableSelect
              options={customerOptions}
              value={selectedCustomerId}
              onChange={(val) => {
                setSelectedCustomerId(val);
                const foundOpt = customerOptions.find(o => o.value === val);
                if (foundOpt) setCustomerName(foundOpt.label);
                markDirty();
              }}
              placeholder="Select Customer or type custom..."
            />
          </div>

          <div className="form-group-field">
            <label><MapPin size={14} /> Delivery Address <span className="req-star">*</span></label>
            <input
              type="text"
              value={address}
              onChange={(e) => { setAddress(e.target.value); markDirty(); }}
              placeholder="1234 Main St, City, State ZIP"
              className="modal-text-input"
            />
          </div>

          {/* Date, Time & Truck */}
          <div className="form-grid-3col">
            <div className="form-group-field">
              <label><Calendar size={14} /> Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); markDirty(); }}
                className="modal-text-input"
              />
            </div>

            <div className="form-group-field">
              <label><Clock size={14} /> Time Slot</label>
              <select
                value={time}
                onChange={(e) => { setTime(e.target.value); markDirty(); }}
                className="modal-select-input"
              >
                {TIME_SLOTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="form-group-field">
              <label><Truck size={14} /> Assigned Driver</label>
              <select
                value={truckId}
                onChange={(e) => { setTruckId(e.target.value); markDirty(); }}
                className="modal-select-input"
              >
                {trucks.map(trk => {
                  const booked = getCapacityForTruck(trk.id);
                  const isFull = booked >= MAX_TRUCK_CAPACITY;
                  return (
                    <option key={trk.id} value={trk.id} disabled={isFull}>
                      {trk.driver} — {booked}/{MAX_TRUCK_CAPACITY}{isFull ? ' FULL' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Sales Rep & Status */}
          <div className="form-grid-2col">
            <div className="form-group-field">
              <label><User size={14} /> Sales Representative</label>
              <input
                type="text"
                value={salesRepName}
                onChange={(e) => { setSalesRepName(e.target.value); markDirty(); }}
                placeholder="Sales Rep Name"
                className="modal-text-input"
              />
            </div>

            <div className="form-group-field">
              <label>Status</label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); markDirty(); }}
                className={`modal-select-input status-select status-${status}`}
              >
                <option value="scheduled">🕐 Scheduled</option>
                <option value="delayed">⚠️ Delayed / Running Late</option>
                <option value="completed">✅ Completed / Delivered</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="form-group-field">
            <label><FileText size={14} /> Delivery Notes &amp; Gate Codes</label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); markDirty(); }}
              placeholder="Forklift needed, gate codes, contact person..."
              rows={3}
              className="modal-textarea-input"
            />
          </div>

          {/* Footer Actions */}
          <div className="manifest-modal-footer">
            {initialData?.id && !confirmDelete && (
              <button
                type="button"
                className="modal-btn-delete"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <div className="footer-right-group">
              <button type="button" className="modal-btn-cancel" onClick={handleClose}>
                Cancel
              </button>
              <button type="submit" className="modal-btn-save">
                <Save size={16} />
                <span>{initialData?.id ? 'Save Changes' : 'Add Delivery'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeliveryModal;
