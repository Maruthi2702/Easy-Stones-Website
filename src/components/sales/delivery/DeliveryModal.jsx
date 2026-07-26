import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, Calendar, Clock, MapPin, User, Truck, FileText, AlertCircle } from 'lucide-react';
import SearchableSelect from '../../SearchableSelect';

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
  customerOptions = [],
  currentUser = null
}) => {
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [address, setAddress] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('09:00 AM');
  const [truckId, setTruckId] = useState(trucks[0]?.id || 'trk_1');
  const [salesRepName, setSalesRepName] = useState(currentUser?.name || 'Krish Manager');
  const [status, setStatus] = useState('scheduled');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setCustomerName(initialData.customerName || '');
      setSelectedCustomerId(initialData.customerId || '');
      setAddress(initialData.address || '');
      setDate(initialData.date || new Date().toISOString().split('T')[0]);
      setTime(initialData.time || '09:00 AM');
      setTruckId(initialData.truckId || trucks[0]?.id || 'trk_1');
      setSalesRepName(initialData.salesRepName || currentUser?.name || 'Sales Rep');
      setStatus(initialData.status || 'scheduled');
      setNotes(initialData.notes || '');
    } else {
      resetForm();
    }
  }, [initialData, isOpen, trucks]);

  const resetForm = () => {
    setCustomerName('');
    setSelectedCustomerId('');
    setAddress('');
    setDate(new Date().toISOString().split('T')[0]);
    setTime('09:00 AM');
    setTruckId(trucks[0]?.id || 'trk_1');
    setSalesRepName(currentUser?.name || 'Sales Rep');
    setStatus('scheduled');
    setNotes('');
    setError('');
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

  const handleDelete = () => {
    if (!initialData?.id) return;
    if (window.confirm(`Are you sure you want to delete delivery for ${customerName}?`)) {
      onDelete(initialData.id);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay-backdrop anim-fade-in" onClick={onClose}>
      <div className="manifest-modal-content anim-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="manifest-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge gold">
              <Truck size={20} />
            </div>
            <div>
              <h3>{initialData ? 'Edit Delivery Ticket' : 'Add New Delivery Ticket'}</h3>
              <p className="modal-sub-text">Dispatch & Capacity Scheduling</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

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
              }}
              placeholder="Select Customer or type custom..."
            />
          </div>

          <div className="form-group-field">
            <label><MapPin size={14} /> Delivery Address <span className="req-star">*</span></label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
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
                onChange={(e) => setDate(e.target.value)}
                className="modal-text-input"
              />
            </div>

            <div className="form-group-field">
              <label><Clock size={14} /> Time Slot</label>
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="modal-select-input"
              >
                {TIME_SLOTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="form-group-field">
              <label><Truck size={14} /> Assigned Truck</label>
              <select
                value={truckId}
                onChange={(e) => setTruckId(e.target.value)}
                className="modal-select-input"
              >
                {trucks.map(trk => (
                  <option key={trk.id} value={trk.id}>
                    {trk.name} ({trk.driver})
                  </option>
                ))}
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
                onChange={(e) => setSalesRepName(e.target.value)}
                placeholder="Sales Rep Name"
                className="modal-text-input"
              />
            </div>

            <div className="form-group-field">
              <label>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="modal-select-input"
              >
                <option value="scheduled">Scheduled</option>
                <option value="delayed">Delayed / Running Late</option>
                <option value="completed">Completed / Delivered</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="form-group-field">
            <label><FileText size={14} /> Delivery Notes & Gate Codes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Forklift needed, gate codes, contact person..."
              rows={3}
              className="modal-textarea-input"
            />
          </div>

          {/* Footer Actions */}
          <div className="manifest-modal-footer">
            {initialData?.id && (
              <button type="button" className="modal-btn-delete" onClick={handleDelete}>
                <Trash2 size={16} /> Delete
              </button>
            )}
            <div className="footer-right-group">
              <button type="button" className="modal-btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="modal-btn-save">
                <Save size={16} />
                <span>{initialData ? 'Save Changes' : 'Add Delivery'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeliveryModal;
