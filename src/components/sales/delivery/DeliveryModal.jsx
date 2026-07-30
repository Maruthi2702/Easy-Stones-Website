import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, Calendar, MapPin, User, Truck, FileText, Hash, AlertCircle, AlertTriangle, Navigation } from 'lucide-react';
import SearchableSelect from '../../SearchableSelect';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';
import { formatForDateInput } from '../../../utils/dateUtils';
import { API_URL } from '../../../config/api';

const ROUTE_OPTIONS = [
  { value: 1, label: 'Stop #1 (1st Stop)' },
  { value: 2, label: 'Stop #2' },
  { value: 3, label: 'Stop #3' },
  { value: 4, label: 'Stop #4' },
  { value: 5, label: 'Stop #5' },
  { value: 6, label: 'Stop #6' },
  { value: 7, label: 'Stop #7' },
  { value: 8, label: 'Stop #8' }
];

function extractCustomerAddress(c) {
  if (!c) return { city: '', street: '', fullAddress: '' };

  const extractStr = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val === '[object Object]' ? '' : val.trim();
    if (typeof val === 'object') {
      const res = val.street || val.address || val.line1 || val.city || val.name || '';
      return typeof res === 'string' ? (res === '[object Object]' ? '' : res.trim()) : String(res || '').trim();
    }
    return String(val).trim();
  };

  // 1. Extract City from top-level and nested address objects
  let city = extractStr(c.city) || extractStr(c.shippingCity) || extractStr(c.billingCity);
  if (!city && c.shippingAddress && typeof c.shippingAddress === 'object') {
    city = extractStr(c.shippingAddress.city);
  }
  if (!city && c.billingAddress && typeof c.billingAddress === 'object') {
    city = extractStr(c.billingAddress.city);
  }
  if (!city && c.address && typeof c.address === 'object') {
    city = extractStr(c.address.city);
  }

  // 2. Extract Street
  let street = extractStr(c.address) || extractStr(c.street) || extractStr(c.shippingAddress) || extractStr(c.billingAddress);
  if (street === city) street = '';

  const state = extractStr(c.state) || extractStr(c.shippingState) || extractStr(c.billingState);

  // Combine street & city if both exist, otherwise city or street
  const parts = [street, city, state].filter(Boolean);
  const fullAddress = parts.join(', ') || city || street;

  return { city, street, fullAddress };
}

const DeliveryModal = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialData = null,
  trucks = [],
  deliveries = [],      // used to compute capacity per driver/date
  customerOptions = [],
  currentUser = null
}) => {
  const [date, setDate] = useState(() => formatForDateInput(new Date()));
  const [routeNumber, setRouteNumber] = useState(1);
  const [truckId, setTruckId] = useState(trucks[0]?.id || '');
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [soNumber, setSoNumber] = useState('');
  const [address, setAddress] = useState('');
  const [salesRepName, setSalesRepName] = useState(currentUser?.name || 'Admin');
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('09:00 AM');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Fallback internal fetch for customer options if parent prop is empty
  const [fetchedCustomerOptions, setFetchedCustomerOptions] = useState([]);
  // Sales Reps list for location
  const [salesRepsList, setSalesRepsList] = useState(['Admin']);

  useEffect(() => {
    if (isOpen) {
      // 1. Fetch customer dropdown if empty
      if (!customerOptions || customerOptions.length === 0) {
        const token = localStorage.getItem('token');
        fetch(`${API_URL}/api/customers/dropdown`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
          .then(res => res.ok ? res.json() : [])
          .then(data => {
            if (Array.isArray(data)) {
              const mapped = data.map(c => {
                const { city, street, fullAddress } = extractCustomerAddress(c);
                return {
                  value: c._id,
                  label: c.company || c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown',
                  city,
                  address: street || city,
                  fullAddress
                };
              });
              setFetchedCustomerOptions(mapped);
            }
          })
          .catch(err => console.warn('Failed to fetch customer options in DeliveryModal:', err));
      }

      // 2. Fetch Sales Reps for user location
      const token = localStorage.getItem('token');
      fetch(`${API_URL}/api/salesreps`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
        .then(res => res.ok ? res.json() : [])
        .then(payload => {
          const list = payload.data || payload || [];
          if (Array.isArray(list)) {
            const userLoc = currentUser?.location;
            const userAssigned = currentUser?.assignedLocations || [];
            let locUsers = list;
            if (userLoc || userAssigned.length > 0) {
              const filterLocs = userAssigned.length > 0 ? userAssigned : [userLoc];
              if (!filterLocs.includes('*')) {
                locUsers = list.filter(u => {
                  const uLocs = u.assignedLocations || (u.location ? [u.location] : []);
                  if (uLocs.includes('*')) return true;
                  return uLocs.some(loc => filterLocs.includes(loc));
                });
              }
            }
            const names = locUsers.map(u => u.name || u.username).filter(Boolean);
            setSalesRepsList(Array.from(new Set(['Admin', ...names])));
          }
        })
        .catch(err => console.warn('Failed to fetch sales reps in DeliveryModal:', err));
    }
  }, [isOpen, customerOptions, currentUser]);

  const activeCustomerOptions = (customerOptions && customerOptions.length > 0) ? customerOptions : fetchedCustomerOptions;

  // Track initial snapshot for dirty state checking
  const initialSnapshot = useRef(null);

  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfirmDelete(false);
      setConfirmClose(false);
      setError('');
      setIsDirty(false);
      if (initialData) {
        const custName = initialData.customerName || '';
        let custId = initialData.customerId || '';
        if (!custId && custName) {
          const match = activeCustomerOptions.find(
            o => o.label?.toLowerCase() === custName.toLowerCase() || o.value === custName
          );
          if (match) custId = match.value;
        }
        setDate(formatForDateInput(initialData.date) || formatForDateInput(new Date()));
        setRouteNumber(Number(initialData.routeNumber) || 1);
        setTruckId(initialData.truckId || trucks[0]?.id || '');
        setCustomerName(custName);
        setSelectedCustomerId(custId || custName);
        setSoNumber(initialData.soNumber || initialData.invoiceNumber || '');
        setAddress(initialData.address || '');
        setSalesRepName(initialData.salesRepName || currentUser?.name || 'Admin');
        setStatus(initialData.status || 'pending');
        setNotes(initialData.notes || '');
        setTime(initialData.time || '09:00 AM');
        initialSnapshot.current = JSON.stringify(initialData);
      } else {
        resetForm();
        initialSnapshot.current = null;
      }
    }
  }, [initialData, isOpen, trucks, currentUser, activeCustomerOptions]);

  const resetForm = () => {
    setDate(formatForDateInput(new Date()));
    setRouteNumber(1);
    setTruckId(trucks[0]?.id || '');
    setCustomerName('');
    setSelectedCustomerId('');
    setSoNumber('');
    setAddress('');
    setSalesRepName(currentUser?.name || 'Admin');
    setStatus('pending');
    setNotes('');
    setTime('09:00 AM');
    setError('');
    setIsDirty(false);
  };

  const markDirty = () => setIsDirty(true);

  // Compute booked capacity count per truck for the selected date
  const getCapacityForTruck = (trkId) => {
    return deliveries.filter(
      d => d.truckId === trkId && d.date === date && d.id !== initialData?.id
    ).length;
  };

  const handleClose = () => {
    if (isDirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    setConfirmClose(false);
    onClose();
  };

  const handleForceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    let finalCustomerName = customerName.trim();
    if (!finalCustomerName && selectedCustomerId) {
      const foundOpt = activeCustomerOptions.find(o => o.value === selectedCustomerId);
      if (foundOpt) finalCustomerName = foundOpt.label;
    }

    if (!finalCustomerName) {
      setError('Please select or enter a Customer Name.');
      return;
    }

    if (!soNumber.trim()) {
      setError('Please enter an SO / Invoice#.');
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
      soNumber: soNumber.trim(),
      invoiceNumber: soNumber.trim(),
      routeNumber: Number(routeNumber) || 1,
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
    <div className="modal-overlay visit-modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>

        {/* Modal Header — same structure as VisitModal */}
        <div className="modal-header">
          <h2>{initialData?.id ? 'Edit Delivery Ticket' : 'New Delivery Ticket'}</h2>
          <button className="close-btn" onClick={handleClose} title="Close">
            <X size={20} />
          </button>
        </div>

        {/* Custom Unsaved Changes Pop-up */}
        {confirmClose && (
          <div className="unsaved-modal-backdrop anim-fade-in" onClick={() => setConfirmClose(false)}>
            <div className="unsaved-modal-card anim-scale-in" onClick={(e) => e.stopPropagation()}>
              <div className="unsaved-modal-header">
                <div className="unsaved-icon-badge">
                  <AlertTriangle size={24} />
                </div>
                <h4>Unsaved Changes</h4>
              </div>
              <p className="unsaved-modal-body">
                You have unsaved changes on this delivery ticket. Are you sure you want to discard your changes and close?
              </p>
              <div className="unsaved-modal-actions">
                <button type="button" className="btn-keep-editing" onClick={() => setConfirmClose(false)}>
                  Keep Editing
                </button>
                <button type="button" className="btn-discard-changes" onClick={handleForceClose}>
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Body — same as VisitModal .modal-body */}
        <div className="modal-body">

          {/* Inline Delete Confirmation Banner */}
          {confirmDelete && (
            <div className="modal-delete-confirm-banner">
              <AlertTriangle size={18} />
              <span>Delete this delivery? This cannot be undone.</span>
              <div className="delete-confirm-actions">
                <button type="button" className="btn-confirm-delete" onClick={handleDeleteConfirmed}>Yes, delete</button>
                <button type="button" className="btn-cancel-delete" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </div>
          )}

          {error && <div className="modal-error-banner" style={{ marginBottom: '1rem' }}><AlertCircle size={18} /> {error}</div>}

          <form onSubmit={handleSubmit} id="delivery-modal-form">

            {/* Date */}
            <div className="form-group">
              <label>Date <span style={{ color: 'red' }}>*</span></label>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); markDirty(); }}
                required
              />
            </div>

            {/* Route Stop & Assigned Driver — 2 col grid like VisitModal */}
            <div className="delivery-form-2col">
              <div className="form-group">
                <label><Navigation size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Route (Stop #)</label>
                <select
                  value={routeNumber}
                  onChange={(e) => { setRouteNumber(Number(e.target.value)); markDirty(); }}
                >
                  {ROUTE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label><Truck size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Assigned Driver <span style={{ color: 'red' }}>*</span></label>
                <select
                  value={truckId}
                  onChange={(e) => { setTruckId(e.target.value); markDirty(); }}
                  required
                >
                  {trucks.map(trk => {
                    const booked = getCapacityForTruck(trk.id);
                    const isFull = booked >= MAX_TRUCK_CAPACITY;
                    return (
                      <option key={trk.id} value={trk.id} disabled={isFull}>
                        {trk.driver || trk.name} — {booked}/{MAX_TRUCK_CAPACITY}{isFull ? ' FULL' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Customer Name */}
            <div className="form-group">
              <label>Customer Name <span style={{ color: 'red' }}>*</span></label>
              <SearchableSelect
                options={activeCustomerOptions}
                value={selectedCustomerId || customerName}
                onChange={(val) => {
                  setSelectedCustomerId(val);
                  const foundOpt = activeCustomerOptions.find(o => o.value === val || o.label === val);
                  if (foundOpt) {
                    setCustomerName(foundOpt.label);
                    setSelectedCustomerId(foundOpt.value);
                    const autoAddr = foundOpt.city || foundOpt.fullAddress || foundOpt.address || '';
                    if (autoAddr && autoAddr !== '[object Object]') setAddress(autoAddr);
                  } else {
                    setCustomerName(val);
                  }
                  markDirty();
                }}
                placeholder="Select Customer or type custom..."
              />
            </div>

            {/* SO / Invoice# & Delivery Address */}
            <div className="delivery-form-2col">
              <div className="form-group">
                <label><Hash size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />SO / Invoice# <span style={{ color: 'red' }}>*</span></label>
                <input
                  type="text"
                  value={soNumber}
                  onChange={(e) => { setSoNumber(e.target.value); markDirty(); }}
                  placeholder="e.g. SO-10492 or INV-8821"
                  required
                />
              </div>

              <div className="form-group">
                <label><MapPin size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Delivery Address <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.78rem' }}>(Optional)</span></label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); markDirty(); }}
                  placeholder="City / Street / Jobsite address..."
                />
              </div>
            </div>

            {/* Sales Rep & Status */}
            <div className="delivery-form-2col">
              <div className="form-group">
                <label><User size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Sales Representative</label>
                {salesRepsList.length > 0 ? (
                  <select
                    value={salesRepName}
                    onChange={(e) => { setSalesRepName(e.target.value); markDirty(); }}
                  >
                    {salesRepsList.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                    {!salesRepsList.includes(salesRepName) && salesRepName && (
                      <option value={salesRepName}>{salesRepName}</option>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={salesRepName}
                    onChange={(e) => { setSalesRepName(e.target.value); markDirty(); }}
                    placeholder="Sales Rep Name"
                  />
                )}
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); markDirty(); }}
                >
                  <option value="pending">⏳ Pending</option>
                  <option value="scheduled">🕐 Scheduled</option>
                  <option value="delayed">⚠️ Delayed / Running Late</option>
                  <option value="completed">✅ Completed / Delivered</option>
                </select>
              </div>
            </div>

            {/* Notes */}
            <div className="form-group">
              <label><FileText size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Delivery Notes &amp; Gate Codes</label>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); markDirty(); }}
                placeholder="Forklift needed, gate codes, contact person..."
                rows={4}
              />
            </div>

          </form>
        </div>

        {/* Modal Footer — same as VisitModal */}
        <div className="modal-footer">
          {initialData?.id && !confirmDelete && (
            <button
              type="button"
              className="modal-btn-delete"
              onClick={() => setConfirmDelete(true)}
              style={{ marginRight: 'auto' }}
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit}>
            {initialData?.id ? 'Save Changes' : 'Add Delivery'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default DeliveryModal;
