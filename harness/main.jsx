// TEMPORARY verification harness (deleted after use): every kind of <select> the
// app styles, with the real stylesheets loaded, to check the dropdown arrow.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/pages/SalesPage.css';
import '../src/pages/SalesPageDashboard.css';
import '../src/pages/AdminPage.css';
import '../src/pages/LeadsSheet.css';
import '../src/components/sales/UsersRolesTab.css';
import '../src/components/sales/dailyreport/DailyReport.css';
import '../src/components/sales/LostSalesTab.css';
import '../src/components/sales/VisitsListDetail.css';
import '../src/components/sales/DeliveryScheduleTab.css';
import '../src/components/sales/AddCustomerModal.css';
import '../src/components/admin/CustomerImportModal.css';
import '../src/components/sales/CheckInLogPanel.css';
import '../src/components/shared/Pagination.css';
import '../src/components/sales/PartnersSheet.css';
import '../src/components/sales/customerList/CustomerList.css';

if (new URLSearchParams(location.search).get('theme') === 'light') document.body.classList.add('light-theme-active');
const opts = <><option>Level 1 → 4</option><option>Company A–Z</option></>;
const Case = ({ name, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '240px 300px', gap: 12, alignItems: 'center', marginBottom: 10 }}>
    <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{name}</span>
    <div data-case={name}>{children}</div>
  </div>
);
createRoot(document.getElementById('root')).render(
  <div style={{ padding: 20, background: 'var(--bg-primary)', minHeight: '100vh' }}>
    <Case name="plain select"><select>{opts}</select></Case>
    <Case name="SalesPage .form-group"><div className="form-group"><select>{opts}</select></div></Case>
    <Case name="UsersRoles modal .form-group"><div className="user-modal-card"><div className="form-group"><select>{opts}</select></div></div></Case>
    <Case name="Admin .role-select"><select className="role-select">{opts}</select></Case>
    <Case name="Daily Report cell"><div className="dr-root"><select className="dr-cell dr-select">{opts}</select></div></Case>
    <Case name="Daily Report location"><div className="dr-root"><div className="dr-locpick"><select>{opts}</select></div></div></Case>
    <Case name="Lost Sales filter"><div className="select-filter-wrap"><select>{opts}</select></div></Case>
    <Case name="Visits location filter"><select className="vlf-select">{opts}</select></Case>
    <Case name="Delivery modal"><div className="delivery-modal-content"><select>{opts}</select></div></Case>
    <Case name="Add customer modal"><div className="add-customer-modal"><select>{opts}</select></div></Case>
    <Case name="Pagination rows"><select className="spag-rows-select">{opts}</select></Case>
    <Case name="Customer list Sort by"><div className="cl"><div className="cl-sheet" style={{ position: 'static', boxShadow: 'none' }}><label className="cl-dd" style={{ display: 'block' }}><select className="cl-dd-btn" style={{ width: '100%', height: 44 }}>{opts}</select></label></div></div></Case>
    <Case name="Customer list Rows"><div className="cl"><nav className="cl-pg"><select><option>25</option></select></nav></div></Case>
  </div>
);
