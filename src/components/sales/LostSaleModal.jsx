import React, { useState, useEffect, useMemo } from 'react';
import { X, DollarSign, Calculator, AlertCircle, Save, Calendar, Building, FileText } from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import CustomSelect from '../shared/CustomSelect';

const REASON_OPTIONS = [
  { id: 'Out of Stock', label: 'Out of Stock', color: '#ef4444' },
  { id: 'Price Too High', label: 'Price Too High / Competitor', color: '#f59e0b' },
  { id: 'Lead Time', label: 'Lead Time / Delivery Delay', color: '#3b82f6' },
  { id: 'Color / Pattern Match', label: 'Color / Pattern Match Issue', color: '#8b5cf6' },
  { id: 'Customer Cancelled', label: 'Customer Cancelled Project', color: '#64748b' },
  { id: 'Quality Issue', label: 'Quality / Defect Concern', color: '#ec4899' },
  { id: 'Other', label: 'Other Reason', color: '#10b981' }
];

const DEFAULT_PRODUCTS = [
  'Calacatta Laza 2CM',
  'Calacatta Laza 3CM',
  'Calacatta Mia Nuo 2CM',
  'Calacatta Mia Nuo 3CM',
  'Carrara White Marble 3CM',
  'Taj Mahal Quartzite 3CM',
  'Super White Quartzite 3CM',
  'Black Galaxy Granite 3CM',
  'Absolute Black Granite 2CM'
];

export const getCustomerName = (c, fallback = 'Unknown Customer') => {
  if (!c) return fallback;
  if (typeof c === 'string') return c;
  if (typeof c === 'object') {
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    return c.company || c.contactName || (fullName.length > 0 ? fullName : null) || c.name || c.fabricatorCompany || fallback;
  }
  return String(c);
};

const LostSaleModal = ({
  isOpen,
  onClose,
  onSave,
  initialData = null,
  customersList = [],
  customerOptions: customerOptionsFromProps = [],
  currentUser = null,
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  onCreateNew = null,
  isDropdownLoading = false
}) => {
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  const [productName, setProductName] = useState('');
  const [isCustomProduct, setIsCustomProduct] = useState(false);

  const [lengthInches, setLengthInches] = useState(126);
  const [widthInches, setWidthInches] = useState(63);
  const [slabsCount, setSlabsCount] = useState(1);
  const [pricePerSf, setPricePerSf] = useState(12.5);

  const [reason, setReason] = useState('Out of Stock');
  const [location, setLocation] = useState('Seattle');
  const [competitorName, setCompetitorName] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [error, setError] = useState('');

  // Formatted Customer Options for SearchableSelect (Identical to VisitModal)
  const resolvedCustomerOptions = useMemo(() => {
    if (customerOptionsFromProps && customerOptionsFromProps.length > 0) {
      return customerOptionsFromProps;
    }
    return (customersList || []).map(c => {
      const labelStr = getCustomerName(c);
      const valId = typeof c === 'object' && c ? (c._id || labelStr) : String(c);
      return { value: valId, label: labelStr };
    }).filter(opt => opt.label && opt.label !== 'Unknown Customer')
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [customerOptionsFromProps, customersList]);

  // Formatted Location Options
  const locationOptions = useMemo(() => {
    return (locationsList || []).map(loc => {
      const locName = typeof loc === 'object' && loc ? (loc.name || loc.locationName || '') : String(loc || '');
      return locName;
    }).filter(Boolean);
  }, [locationsList]);

  useEffect(() => {
    if (initialData) {
      setCustomerName(getCustomerName(initialData.customerName, ''));
      setSelectedCustomerId(initialData.customerId || '');
      setProductName(getCustomerName(initialData.productName, ''));
      setIsCustomProduct(!DEFAULT_PRODUCTS.includes(getCustomerName(initialData.productName)));
      setLengthInches(initialData.lengthInches || 126);
      setWidthInches(initialData.widthInches || 63);
      setSlabsCount(initialData.slabsCount || 1);
      setPricePerSf(initialData.pricePerSf || 0);
      setReason(initialData.reason || 'Out of Stock');
      setLocation(getCustomerName(initialData.location, locationOptions[0] || 'Seattle'));
      setCompetitorName(getCustomerName(initialData.competitorName, ''));
      setNotes(getCustomerName(initialData.notes, ''));
      if (initialData.date) {
        setDate(new Date(initialData.date).toISOString().split('T')[0]);
      }
    } else {
      resetForm();
    }
  }, [initialData, isOpen, locationOptions]);

  const resetForm = () => {
    setCustomerName('');
    setSelectedCustomerId('');
    setProductName(DEFAULT_PRODUCTS[0]);
    setIsCustomProduct(false);
    setLengthInches(126);
    setWidthInches(63);
    setSlabsCount(1);
    setPricePerSf(12.5);
    setReason('Out of Stock');

    const firstLoc = locationOptions.length > 0 ? locationOptions[0] : 'Seattle';
    setLocation(firstLoc);
    setCompetitorName('');
    setNotes('');
    setDate(new Date().toISOString().split('T')[0]);
    setError('');
  };

  // Live Calculations
  const l = parseFloat(lengthInches) || 0;
  const w = parseFloat(widthInches) || 0;
  const count = parseInt(slabsCount, 10) || 0;
  const price = parseFloat(pricePerSf) || 0;

  const sfPerSlab = (l * w) / 144;
  const totalSf = sfPerSlab * count;
  const totalLostValue = totalSf * price;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    let finalCustomerName = customerName.trim();
    if (!finalCustomerName && selectedCustomerId) {
      const foundOpt = resolvedCustomerOptions.find(o => o.value === selectedCustomerId);
      if (foundOpt) finalCustomerName = foundOpt.label;
    }

    if (!finalCustomerName && !selectedCustomerId) {
      setError('Please select a Customer from the dropdown.');
      return;
    }

    if (!productName.trim()) {
      setError('Please select or enter a Product Name.');
      return;
    }

    if (count <= 0) {
      setError('Number of slabs must be greater than 0.');
      return;
    }

    if (price <= 0) {
      setError('Price per SF must be greater than 0.');
      return;
    }

    const payload = {
      _id: initialData?._id || `ls_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      customerId: selectedCustomerId || null,
      customerName: finalCustomerName,
      productName: productName.trim(),
      lengthInches: l,
      widthInches: w,
      sfPerSlab: Math.round(sfPerSlab * 100) / 100,
      slabsCount: count,
      totalSf: Math.round(totalSf * 100) / 100,
      pricePerSf: price,
      totalLostValue: Math.round(totalLostValue * 100) / 100,
      reason,
      location,
      competitorName: competitorName.trim(),
      notes: notes.trim(),
      salesRepName: currentUser?.name || currentUser?.username || 'Sales Rep',
      salesRepId: currentUser?._id || currentUser?.id,
      date: new Date(date).toISOString(),
      createdAt: initialData?.createdAt || new Date().toISOString()
    };

    onSave(payload);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay-backdrop anim-fade-in" onClick={onClose}>
      <div className="lost-sale-modal-content anim-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lost-sale-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge">
              <DollarSign size={20} />
            </div>
            <div>
              <h3>{initialData ? 'Edit Lost Sale Opportunity' : 'Record New Lost Sale'}</h3>
              <p className="modal-sub-text">Log lost revenue, competitor pricing & stock shortages</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="lost-sale-modal-form">
          {error && <div className="modal-error-banner"><AlertCircle size={18} /> {error}</div>}

          {/* Section 1: Customer & Date */}
          <div className="form-grid-2col">
            <div className="form-group-field">
              <label>
                Customer <span className="req-star">*</span>
              </label>
              <SearchableSelect
                options={resolvedCustomerOptions}
                value={selectedCustomerId}
                onChange={(val) => {
                  setSelectedCustomerId(val);
                  const foundOpt = resolvedCustomerOptions.find(o => o.value === val);
                  if (foundOpt) setCustomerName(foundOpt.label);
                }}
                placeholder="Select a Customer..."
                onCreateNew={onCreateNew}
                createNewLabel="New Customer"
                isLoading={isDropdownLoading}
              />
            </div>

            <div className="form-group-field">
              <label>
                <Calendar size={14} /> Date of Lost Opportunity
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="modal-text-input"
              />
            </div>
          </div>

          {/* Section 2: Product Name */}
          <div className="form-grid-2col">
            <div className="form-group-field">
              <label>
                Product Name <span className="req-star">*</span>
              </label>
              {!isCustomProduct ? (
                <SearchableSelect
                  options={DEFAULT_PRODUCTS}
                  value={productName}
                  onChange={(val) => setProductName(val)}
                  placeholder="Select Product..."
                  onCreateNew={() => {
                    setIsCustomProduct(true);
                    setProductName('');
                  }}
                  createNewLabel="✏️ + Enter Custom Product Name"
                />
              ) : (
                <div className="custom-input-with-back">
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Calacatta Gold Marble 3CM"
                    className="modal-text-input"
                    autoFocus
                  />
                  <button type="button" className="btn-link-small" onClick={() => setIsCustomProduct(false)}>
                    Select List
                  </button>
                </div>
              )}
            </div>

            <div className="form-group-field">
              <label>
                <Building size={14} /> Showroom Location
              </label>
              <CustomSelect
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                options={locationOptions.map(locName => ({ value: locName, label: locName }))}
              />
            </div>
          </div>

          {/* Section 3: Calculations (Dimensions, Slabs, Price) */}
          <div className="lost-sale-calc-box">
            <div className="calc-box-header">
              <Calculator size={16} />
              <span>Slab Size & Automatic SF Calculation</span>
            </div>

            <div className="calc-inputs-grid">
              <div className="calc-field">
                <label>Length (in)</label>
                <input
                  type="number"
                  value={lengthInches}
                  onChange={(e) => setLengthInches(e.target.value)}
                  placeholder="126"
                  className="calc-num-input"
                  min="1"
                />
              </div>

              <div className="calc-field">
                <label>Width (in)</label>
                <input
                  type="number"
                  value={widthInches}
                  onChange={(e) => setWidthInches(e.target.value)}
                  placeholder="63"
                  className="calc-num-input"
                  min="1"
                />
              </div>

              <div className="calc-field">
                <label>No. of Slabs</label>
                <input
                  type="number"
                  value={slabsCount}
                  onChange={(e) => setSlabsCount(e.target.value)}
                  placeholder="1"
                  className="calc-num-input"
                  min="1"
                />
              </div>

              <div className="calc-field">
                <label>Price / SF ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={pricePerSf}
                  onChange={(e) => setPricePerSf(e.target.value)}
                  placeholder="12.50"
                  className="calc-num-input"
                  min="0"
                />
              </div>
            </div>

            {/* Real-time Computed Summary Pill */}
            <div className="calc-live-result-banner">
              <div className="calc-stat-item">
                <span className="stat-lbl">SF / Slab:</span>
                <span className="stat-val">{sfPerSlab.toFixed(2)} SF</span>
              </div>
              <div className="calc-stat-item">
                <span className="stat-lbl">Total SF ({count} Slabs):</span>
                <span className="stat-val">{totalSf.toFixed(2)} SF</span>
              </div>
              <div className="calc-stat-item highlight-total">
                <span className="stat-lbl">Total Lost Sale Value:</span>
                <span className="stat-val-gold">${totalLostValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Section 4: Reason & Competitor */}
          <div className="form-grid-2col" style={{ marginTop: '1.25rem' }}>
            <div className="form-group-field">
              <label>
                Primary Reason Lost <span className="req-star">*</span>
              </label>
              <CustomSelect
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                options={REASON_OPTIONS.map(r => ({ value: r.id, label: r.label }))}
              />
            </div>

            <div className="form-group-field">
              <label>Competitor Name (Optional)</label>
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="e.g. MSI, Bedrosians, Arizona Tile"
                className="modal-text-input"
              />
            </div>
          </div>

          {/* Section 5: Additional Notes */}
          <div className="form-group-field" style={{ marginTop: '1rem' }}>
            <label>
              <FileText size={14} /> Notes / Additional Details
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter details, competitor prices, slab batch notes..."
              rows={3}
              className="modal-textarea-input"
            />
          </div>

          {/* Footer Buttons */}
          <div className="lost-sale-modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="modal-btn-save">
              <Save size={18} />
              <span>{initialData ? 'Update Opportunity' : 'Save Lost Sale'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LostSaleModal;
