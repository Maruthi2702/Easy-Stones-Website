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
  const [salesRepName, setSalesRepName] = useState(currentUser?.name || '');
  const [status, setStatus] = useState('scheduled');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('09:00 AM');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Fallback internal fetch for customer options if parent prop is empty
  const [fetchedCustomerOptions, setFetchedCustomerOptions] = useState([]);
  // Sales Reps list for location
  const [salesRepsList, setSalesRepsList] = useState([]);

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
                const addrPart = c.address || c.street || c.shippingAddress || c.billingAddress || '';
                const cityPart = c.city || c.shippingCity || c.billingCity || '';
                const statePart = c.state || c.shippingState || c.billingState || '';
                const zipPart = c.zip || c.postalCode || c.shippingZip || '';
                const fullAddr = [addrPart, cityPart, statePart, zipPart].filter(Boolean).join(', ') || cityPart || addrPart;
                return {
                  value: c._id,
                  label: c.company || c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown',
                  city: cityPart,
                  address: addrPart,
                  fullAddress: fullAddr
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
            if (names.length > 0) {
              setSalesRepsList(Array.from(new Set(names)));
            }
          }
        })
        .catch(err => console.warn('Failed to fetch sales reps in DeliveryModal:', err));
    }
  }, [isOpen, customerOptions, currentUser]);

  const activeCustomerOptions = (customerOptions && customerOptions.length > 0) ? customerOptions : fetchedCustomerOptions;

  // Track initial snapshot for dirty state checking
  const initialSnapshot = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmDelete(false);
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
        setSalesRepName(initialData.salesRepName || currentUser?.name || '');
        setStatus(initialData.status || 'scheduled');
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
    setSalesRepName(currentUser?.name || '');
    setStatus('scheduled');
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
      const foundOpt = activeCustomerOptions.find(o => o.value === selectedCustomerId);
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

          {/* 1. DATE, ROUTE NUMBER & DRIVER FIELD */}
          <div className="form-grid-3col">
            <div className="form-group-field">
              <label><Calendar size={14} /> Date <span className="req-star">*</span></label>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); markDirty(); }}
                className="modal-text-input"
              />
            </div>

            <div className="form-group-field">
              <label><Navigation size={14} /> Route Number (Stop #)</label>
              <select
                value={routeNumber}
                onChange={(e) => { setRouteNumber(Number(e.target.value)); markDirty(); }}
                className="modal-select-input"
              >
                {ROUTE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group-field">
              <label><Truck size={14} /> Assigned Driver <span className="req-star">*</span></label>
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
                      {trk.driver || trk.name} — {booked}/{MAX_TRUCK_CAPACITY}{isFull ? ' FULL' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* 2. CUSTOMER NAME FIELD */}
          <div className="form-group-field">
            <label>Customer Name <span className="req-star">*</span></label>
            <SearchableSelect
              options={activeCustomerOptions}
              value={selectedCustomerId || customerName}
              onChange={(val) => {
                setSelectedCustomerId(val);
                const foundOpt = activeCustomerOptions.find(o => o.value === val || o.label === val);
                if (foundOpt) {
                  setCustomerName(foundOpt.label);
                  setSelectedCustomerId(foundOpt.value);
                  const autoAddr = foundOpt.fullAddress || foundOpt.city || foundOpt.address || '';
                  if (autoAddr) {
                    setAddress(autoAddr);
                  }
                } else {
                  setCustomerName(val);
                }
                markDirty();
              }}
              placeholder="Select Customer or type custom..."
            />
          </div>

          {/* 3. SO#/INVOICE NUMBER & DELIVERY ADDRESS */}
          <div className="form-grid-2col">
            <div className="form-group-field">
              <label><Hash size={14} /> SO# / Invoice # <span className="opt-subtext">(ERP Tracking)</span></label>
              <input
                type="text"
                value={soNumber}
                onChange={(e) => { setSoNumber(e.target.value); markDirty(); }}
                placeholder="e.g. SO-10492 or INV-8821"
                className="modal-text-input"
              />
            </div>

            <div className="form-group-field">
              <label><MapPin size={14} /> Delivery Address <span className="req-star">*</span></label>
              <input
                type="text"
                value={address}
                onChange={(e) => { setAddress(e.target.value); markDirty(); }}
                placeholder="City / Street / Jobsite address..."
                className="modal-text-input"
              />
            </div>
          </div>

          {/* 4. SALES REP & STATUS */}
          <div className="form-grid-2col">
            <div className="form-group-field">
              <label><User size={14} /> Sales Representative</label>
              {salesRepsList.length > 0 ? (
                <select
                  value={salesRepName}
                  onChange={(e) => { setSalesRepName(e.target.value); markDirty(); }}
                  className="modal-select-input"
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
                  className="modal-text-input"
                />
              )}
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

          {/* 5. NOTES */}
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
