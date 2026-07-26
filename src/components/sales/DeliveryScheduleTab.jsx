import React, { useState } from 'react';
import { Truck, Calendar, Clock, MapPin, Search, Filter, Plus, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import './DeliveryScheduleTab.css';

const INITIAL_SAMPLE_DELIVERIES = [
  {
    id: 'del_1',
    customerName: 'Apex Marble & Granite',
    address: '1420 E Trent Ave, Spokane, WA',
    driver: 'Dave Miller',
    status: 'Scheduled',
    deliveryDate: new Date().toISOString().split('T')[0],
    timeSlot: '09:00 AM - 11:00 AM',
    itemsCount: 14,
    location: 'Spokane',
    notes: 'Forklift available on site. Contact John before arrival.'
  },
  {
    id: 'del_2',
    customerName: 'Five Star Granite, Inc.',
    address: '8810 8th Ave S, Seattle, WA',
    driver: 'Mark Stevens',
    status: 'In Transit',
    deliveryDate: new Date().toISOString().split('T')[0],
    timeSlot: '11:30 AM - 01:30 PM',
    itemsCount: 22,
    location: 'Seattle',
    notes: 'Delivering Calacatta slabs.'
  }
];

const DeliveryScheduleTab = ({
  currentUser = null,
  theme = 'dark',
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  sidebarToggle = null
}) => {
  const [deliveries, setDeliveries] = useState(INITIAL_SAMPLE_DELIVERIES);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All');

  const filteredDeliveries = deliveries.filter(item => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || (
      item.customerName.toLowerCase().includes(q) ||
      item.address.toLowerCase().includes(q) ||
      item.driver.toLowerCase().includes(q)
    );
    const matchesStatus = selectedStatus === 'All' || item.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className={`delivery-schedule-container high-density ${theme}-theme-active`}>
      {/* Header Bar */}
      <div className="delivery-schedule-header compact-header">
        <div className="header-left-title">
          {sidebarToggle}
          <div className="header-icon-ring compact">
            <Truck size={18} />
          </div>
          <h2 className="title-text-compact">Delivery Schedule</h2>
        </div>

        <div className="header-right-actions">
          <button type="button" className="btn-add-delivery">
            <Plus size={16} />
            <span>Schedule Delivery</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="delivery-filter-bar compact">
        <div className="search-input-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customer, address, driver..."
          />
        </div>

        <div className="filter-dropdowns">
          <div className="select-filter-wrap">
            <Filter size={14} className="filter-icon" />
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
              <option value="All">All Statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="In Transit">In Transit</option>
              <option value="Completed">Completed</option>
              <option value="Delayed">Delayed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Data Grid / Cards */}
      <div className="delivery-grid-wrapper high-capacity">
        <div className="delivery-card-list">
          {filteredDeliveries.map(item => (
            <div key={item.id} className="delivery-item-card">
              <div className="delivery-card-top">
                <div className="delivery-cust-info">
                  <h4>{item.customerName}</h4>
                  <span className="delivery-address"><MapPin size={14} /> {item.address}</span>
                </div>
                <span className={`delivery-status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
                  {item.status}
                </span>
              </div>

              <div className="delivery-card-details">
                <div className="detail-chip">
                  <Calendar size={13} />
                  <span>{item.deliveryDate}</span>
                </div>
                <div className="detail-chip">
                  <Clock size={13} />
                  <span>{item.timeSlot}</span>
                </div>
                <div className="detail-chip">
                  <Truck size={13} />
                  <span>Driver: {item.driver}</span>
                </div>
                <div className="detail-chip">
                  <span>{item.itemsCount} Slabs</span>
                </div>
              </div>

              {item.notes && (
                <div className="delivery-card-notes">
                  <FileText size={13} />
                  <span>{item.notes}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DeliveryScheduleTab;
