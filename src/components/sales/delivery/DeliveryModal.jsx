import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, Calendar, MapPin, User, Truck, FileText, Hash, AlertCircle, AlertTriangle, Navigation, Activity } from 'lucide-react';
import SearchableSelect from '../../SearchableSelect';
import CustomSelect from '../../shared/CustomSelect';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';
import { formatForDateInput } from '../../../utils/dateUtils';
import { formatTitleCase } from '../../../utils/textUtils';
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
  const [truckId, setTruckId] = useState('');
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

  // New Classification & 3rd Party States
  const [deliveryType, setDeliveryType] = useState('jobsite');
  const [transferDestination, setTransferDestination] = useState('Spokane');
  const [pickupInfo, setPickupInfo] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [proNumber, setProNumber] = useState('');
  const [freightFee, setFreightFee] = useState('');
  const [packingListUrl, setPackingListUrl] = useState('');
  const [packingListFilename, setPackingListFilename] = useState('');

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
            // Filter by allowed sales roles (Sales Rep, Manager, Director, Admin)
            locUsers = locUsers.filter(u => {
              const r = (u.role || '').toLowerCase();
              return !u.role || r.includes('sales') || r.includes('manager') || r.includes('director') || r.includes('admin');
            });
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
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Re-initialize form whenever the modal opens or the data identity changes
  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(false);
    setConfirmClose(false);
    setError('');
    setIsDirty(false);
    setIsSaving(false);
    setIsReadingPdf(false);
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
      setTruckId(initialData.truckId || '');
      setCustomerName(custName);
      setSelectedCustomerId(custId || custName);
      setSoNumber(initialData.soNumber || initialData.invoiceNumber || '');
      setAddress(initialData.address || '');
      setSalesRepName(initialData.salesRepName || currentUser?.name || 'Admin');
      setStatus(initialData.status || 'pending');
      setNotes(initialData.notes || '');
      setTime(initialData.time || '09:00 AM');
      setDeliveryType(initialData.deliveryType || 'jobsite');
      setTransferDestination(initialData.transferDestination || 'Spokane');
      setPickupInfo(initialData.pickupInfo || '');
      setCarrierName(initialData.carrierName || '');
      setProNumber(initialData.proNumber || '');
      setFreightFee(initialData.freightFee || '');
      setPackingListUrl(initialData.packingListUrl || '');
      setPackingListFilename(initialData.packingListFilename || '');
      initialSnapshot.current = JSON.stringify(initialData);
    } else {
      resetForm();
      initialSnapshot.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData?.id]);

  const resetForm = () => {
    setDate(formatForDateInput(new Date()));
    setRouteNumber(1);
    setTruckId('');
    setCustomerName('');
    setSelectedCustomerId('');
    setSoNumber('');
    setAddress('');
    setSalesRepName(currentUser?.name || 'Admin');
    setStatus('pending');
    setNotes('');
    setTime('09:00 AM');
    setDeliveryType('jobsite');
    setTransferDestination('Spokane');
    setPickupInfo('');
    setCarrierName('');
    setProNumber('');
    setFreightFee('');
    setPackingListUrl('');
    setPackingListFilename('');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isReadingPdf) {
      setError('Please wait for the PDF document to finish attaching...');
      return;
    }

    let finalCustomerName = customerName.trim();
    if (!finalCustomerName && selectedCustomerId) {
      const foundOpt = activeCustomerOptions.find(o => o.value === selectedCustomerId);
      if (foundOpt) finalCustomerName = foundOpt.label;
    }

    if (!finalCustomerName) {
      setError('Please select or enter a Customer Name.');
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
      location: initialData?.location || currentUser?.location || '',
      deliveryType,
      transferDestination,
      pickupInfo: pickupInfo.trim(),
      carrierName: carrierName.trim(),
      proNumber: proNumber.trim(),
      freightFee: Number(freightFee) || 0,
      packingListUrl,
      packingListFilename,
      updatedAt: new Date().toISOString()
    };

    setIsSaving(true);
    try {
      await onSave(payload);  // Wait for DB round-trip before closing
      onClose();
    } catch (err) {
      console.error('[DeliveryModal] save failed:', err);
      setError('Failed to save delivery. Please try again.');
    } finally {
      setIsSaving(false);
    }
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

        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ background: 'rgba(212, 175, 55, 0.15)', border: '1px solid rgba(212, 175, 55, 0.3)', padding: '0.45rem', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={18} style={{ color: '#d4af37' }} />
            </div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
              {initialData?.id ? 'Edit Delivery Ticket' : 'New Delivery Ticket'}
            </h2>
          </div>
          <button className="delivery-modal-close-btn" onClick={handleClose} title="Close">
            <X size={18} />
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

          {/* Delivery Form Controls */}
        <form onSubmit={handleSubmit} className="delivery-modal-content">

          {/* ── DATE & DELIVERY TYPE (SIDE BY SIDE) ── */}
          <div className="delivery-form-2col" style={{ marginBottom: '1.1rem' }}>
            <div className="form-group">
              <label><Calendar size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Date <span className="req-star">*</span></label>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); markDirty(); }}
                required
              />
            </div>

            <div className="form-group">
              <label><Truck size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Delivery Type</label>
              <CustomSelect
                value={deliveryType}
                onChange={(e) => { setDeliveryType(e.target.value); markDirty(); }}
                options={[
                  { value: 'jobsite', label: '🚚 Delivery' },
                  { value: 'transfer', label: '🔄 Inter-Branch Transfer' },
                  { value: 'will_call', label: '🏭 Will Call Pickup' }
                ]}
              />
            </div>
          </div>

            {/* Customer Name */}
            <div className="form-group" style={{ marginBottom: '1.1rem' }}>
              <label><User size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Customer Name <span className="req-star">*</span></label>
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
                    setCustomerName(formatTitleCase(val));
                  }
                  markDirty();
                }}
                placeholder="Select Customer or type custom..."
              />
            </div>

            {/* SO / Invoice# & Delivery Address */}
            <div className="delivery-form-2col" style={{ marginBottom: '1.1rem' }}>
              <div className="form-group">
                <label><Hash size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />SO / Invoice#</label>
                <input
                  type="text"
                  value={soNumber}
                  onChange={(e) => { setSoNumber(e.target.value); markDirty(); }}
                  placeholder="SO / Invoice #"
                />
              </div>

              <div className="form-group">
                <label><MapPin size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Delivery Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); markDirty(); }}
                  placeholder="City / Street / Jobsite address..."
                />
              </div>
            </div>

            {/* Route Stop & Assigned Driver — 2 col grid */}
            <div className="delivery-form-2col" style={{ marginBottom: '1.1rem' }}>
              <div className="form-group">
                <label><Navigation size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Route (Stop #)</label>
                <CustomSelect
                  value={routeNumber}
                  onChange={(e) => { setRouteNumber(Number(e.target.value)); markDirty(); }}
                  options={ROUTE_OPTIONS}
                />
              </div>

              <div className="form-group">
                <label><Truck size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Assigned Driver / Fleet</label>
                <CustomSelect
                  value={truckId}
                  onChange={(e) => { setTruckId(e.target.value); markDirty(); }}
                  options={[
                    { value: '', label: '-- Unassigned / Pending Driver --' },
                    ...trucks.map(trk => {
                      const booked = getCapacityForTruck(trk.id);
                      const isFull = trk.id !== 'trk_3rd_party' && booked >= MAX_TRUCK_CAPACITY;
                      return {
                        value: trk.id,
                        label: trk.id === 'trk_3rd_party'
                          ? `🚚 3rd Party — Contract Freight`
                          : `${trk.driver || trk.name} — ${booked}/${MAX_TRUCK_CAPACITY}${isFull ? ' FULL' : ''}`,
                        disabled: isFull
                      };
                    })
                  ]}
                />
              </div>
            </div>

            {/* Conditional 3rd Party Freight Fields */}
            {truckId === 'trk_3rd_party' && (
              <div className="delivery-form-3col 3rd-party-banner-fields" style={{ background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.25)', padding: '0.85rem', borderRadius: '12px', marginBottom: '1.1rem' }}>
                <div className="form-group">
                  <label style={{ color: '#c084fc' }}>Carrier / Freight Company</label>
                  <input
                    type="text"
                    value={carrierName}
                    onChange={(e) => { setCarrierName(e.target.value); markDirty(); }}
                    placeholder="e.g. R+L Carriers, Swift, Old Dominion"
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: '#c084fc' }}>PRO / BOL Tracking #</label>
                  <input
                    type="text"
                    value={proNumber}
                    onChange={(e) => { setProNumber(e.target.value); markDirty(); }}
                    placeholder="e.g. PRO-984102"
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: '#c084fc' }}>Freight Charge ($)</label>
                  <input
                    type="number"
                    value={freightFee}
                    onChange={(e) => { setFreightFee(e.target.value); markDirty(); }}
                    placeholder="e.g. 350"
                  />
                </div>
              </div>
            )}

            {/* Conditional Inter-Branch Transfer Fields */}
            {deliveryType === 'transfer' && (
              <div className="form-group" style={{ marginBottom: '1.1rem' }}>
                <label style={{ color: '#60a5fa' }}>Destination Showroom Location</label>
                <CustomSelect
                  value={transferDestination}
                  onChange={(e) => { setTransferDestination(e.target.value); markDirty(); }}
                  options={[
                    { value: 'Seattle', label: '📍 Seattle Showroom' },
                    { value: 'Spokane', label: '📍 Spokane Showroom' },
                    { value: 'Salt Lake City', label: '📍 Salt Lake City Showroom' }
                  ]}
                />
              </div>
            )}

            {/* Conditional Will Call Pickup Fields */}
            {deliveryType === 'will_call' && (
              <div className="form-group" style={{ marginBottom: '1.1rem' }}>
                <label style={{ color: '#2dd4bf' }}>Customer Pickup Vehicle &amp; Driver Info</label>
                <input
                  type="text"
                  value={pickupInfo}
                  onChange={(e) => { setPickupInfo(e.target.value); markDirty(); }}
                  placeholder="e.g. Customer Flatbed Trailer, License # 7ABC12, Driver: Dave"
                />
              </div>
            )}

            {/* Sales Rep & Status */}
            <div className="delivery-form-2col" style={{ marginBottom: '1.1rem' }}>
              <div className="form-group">
                <label><User size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Sales Representative</label>
                <CustomSelect
                  value={salesRepName}
                  onChange={(e) => { setSalesRepName(e.target.value); markDirty(); }}
                  options={Array.from(new Set([...salesRepsList, salesRepName].filter(Boolean))).map(name => ({ value: name, label: name }))}
                />
              </div>

              <div className="form-group">
                <label><Activity size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Status</label>
                <CustomSelect
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); markDirty(); }}
                  options={[
                    { value: 'pending', label: '⏳ Pending' },
                    { value: 'scheduled', label: '🕐 Scheduled' },
                    { value: 'delayed', label: '⚠️ Delayed / Running Late' },
                    { value: 'completed', label: '✅ Completed / Delivered' }
                  ]}
                />
              </div>
            </div>

            {/* Packing List PDF Attachment Upload */}
            <div className="form-group" style={{ marginBottom: '1.1rem' }}>
              <label>
                <FileText size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Packing List PDF
              </label>

              <div className="file-upload-input-wrap" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '4px' }}>
                <input
                  type="text"
                  value={
                    packingListUrl && packingListUrl.toLowerCase().startsWith('data:application/')
                      ? (packingListFilename || 'Attached_Packing_List.pdf')
                      : packingListUrl
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setPackingListUrl(val);
                    if (val.startsWith('http://') || val.startsWith('https://')) {
                      const parts = val.split('/');
                      setPackingListFilename(parts[parts.length - 1] || 'PackingList.pdf');
                    } else {
                      setPackingListFilename(val);
                    }
                    markDirty();
                  }}
                  placeholder="Paste PDF link or click Browse PDF..."
                  style={{ flex: 1, textTransform: 'none' }}
                />
                <label className="pdf-browse-label-btn" style={{ background: 'rgba(212, 175, 55, 0.15)', border: '1px solid rgba(212, 175, 55, 0.3)', color: '#d4af37', padding: '0.65rem 0.85rem', borderRadius: '10px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        setIsReadingPdf(true);
                        setPackingListFilename(file.name);
                        try {
                          const formData = new FormData();
                          formData.append('file', file);
                          const token = localStorage.getItem('token');
                          const res = await fetch(`${API_URL}/api/deliveries/upload-packing-list`, {
                            method: 'POST',
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                            body: formData
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setPackingListUrl(data.url);
                            setPackingListFilename(data.filename || file.name);
                            markDirty();
                          } else {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setPackingListUrl(reader.result);
                              markDirty();
                            };
                            reader.readAsDataURL(file);
                          }
                        } catch (err) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setPackingListUrl(reader.result);
                            markDirty();
                          };
                          reader.readAsDataURL(file);
                        } finally {
                          setIsReadingPdf(false);
                        }
                      }
                    }}
                  />
                  {isReadingPdf ? 'Attaching PDF...' : 'Browse PDF'}
                </label>
              </div>

              {packingListUrl && (
                <div className="attached-pdf-banner" style={{ background: 'rgba(212, 175, 55, 0.08)', border: '1px solid rgba(212, 175, 55, 0.3)', borderRadius: '12px', padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                    <FileText size={18} style={{ color: '#d4af37', flexShrink: 0 }} />
                    <div style={{ overflow: 'hidden' }}>
                      <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.82rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {packingListFilename || 'Attached_Packing_List.pdf'}
                      </span>
                      <span style={{ color: '#34d399', fontSize: '0.72rem' }}>✓ PDF Document Attached &amp; Ready</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <a
                      href={initialData?.pod?.signedPdfUrl || packingListUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-view-pdf"
                      style={{ background: 'linear-gradient(135deg, #d4af37, #c5a028)', color: '#000000', padding: '0.35rem 0.7rem', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      View PDF
                    </a>
                    <button
                      type="button"
                      onClick={() => { setPackingListUrl(''); setPackingListFilename(''); markDirty(); }}
                      style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', padding: '0.35rem 0.55rem', borderRadius: '8px', fontSize: '0.78rem', cursor: 'pointer' }}
                      title="Remove PDF"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="form-group" style={{ marginBottom: '0.5rem' }}>
              <label><FileText size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Delivery Notes</label>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); markDirty(); }}
                placeholder=""
                rows={4}
              />
            </div>

          </form>
        </div>

        {/* Modal Footer */}
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
          <button type="button" className="delivery-modal-cancel-btn" onClick={handleClose}>
            Cancel
          </button>
          <button type="button" className="delivery-modal-submit-btn" onClick={handleSubmit} disabled={isReadingPdf || isSaving}>
            {isSaving ? 'Saving...' : isReadingPdf ? 'Attaching PDF...' : (initialData?.id ? 'Save Changes' : 'Add Delivery')}
          </button>
        </div>

      </div>
    </div>
  );
};

export default DeliveryModal;
