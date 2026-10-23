import React, { useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { splitCustomer } from './visitsListHelpers';
import CustomerDrawer from './customerList/CustomerDrawer';
import './customerList/CustomerList.css';

/**
 * A visit's customer, as the basic card (the Customers list's side drawer) —
 * opened from the customer's name on a dashboard visit. Read-only here: no
 * edit, delete or status change (those are on the Customers list). The card
 * opens at once from what the visit knows and fills in behind it; a login
 * without Full profile gets the basic record from GET /api/customers/:id (the
 * drawer fetches the full one itself when `canProfile`). "Open profile" goes
 * to the full profile page.
 */
const VisitCustomerCard = ({ visit, canProfile, onClose, onOpenProfile }) => {
  const id = visit?.customerId;
  const [basic, setBasic] = useState(null);

  useEffect(() => {
    if (!id || canProfile) return undefined;
    let live = true;
    authFetch(`${API_URL}/api/customers/${id}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (live && data) setBasic(data); })
      .catch(() => { /* the card keeps what the visit has */ });
    return () => { live = false; };
  }, [id, canProfile]);

  if (!id) return null;
  const { company, contact } = splitCustomer(visit);
  const shell = { _id: id, company, contactName: contact, location: visit.location || '' };
  return (
    <CustomerDrawer
      key={id}
      customer={{ ...shell, ...(basic || {}) }}
      overlay
      onClose={onClose}
      onOpenProfile={onOpenProfile}
      canProfile={canProfile}
      canEdit={false}
      canDelete={false}
      onStatusChange={async () => false}
    />
  );
};

export default VisitCustomerCard;
