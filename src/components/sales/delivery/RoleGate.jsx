import React from 'react';
import { Shield, Eye, Truck, RefreshCw } from 'lucide-react';

const ROLES = [
  {
    id: 'office',
    label: 'Office (Dispatcher)',
    icon: Shield,
    desc: 'Full dispatch control: Add, edit, delete, and manage week routes & trucks.',
    badgeColor: '#D4AF37'
  },
  {
    id: 'sales',
    label: 'Sales Rep (Capacity Check)',
    icon: Eye,
    desc: 'Read-only capacity grid with live 6/8 truck volume & customer search.',
    badgeColor: '#3B82F6'
  },
  {
    id: 'driver',
    label: 'Driver (Mobile View)',
    icon: Truck,
    desc: 'Mobile stop-by-stop list with 1-tap "Delivered" & "Running Late" updates.',
    badgeColor: '#2F8F73'
  }
];

const RoleGate = ({ currentRole, onSelectRole, currentUser = null }) => {
  const isManagerOrAdmin = !currentUser || 
    currentUser.role === 'admin' || 
    currentUser.role === 'manager' || 
    currentUser.permissions?.includes('edit_delivery_schedule') ||
    currentUser.permissions?.includes('manage_delivery_schedule');

  return (
    <div className="manifest-role-bar">
      <div className="role-selector-pills">
        <span className="role-bar-label">
          User Account Mode ({currentUser?.name || currentUser?.role || 'Active User'}):
        </span>
        {ROLES.map(r => {
          const Icon = r.icon;
          const isActive = currentRole === r.id;

          // If not admin/manager, hide unpermitted mode switches
          if (!isManagerOrAdmin && !isActive) return null;

          return (
            <button
              key={r.id}
              type="button"
              className={`role-pill-btn ${isActive ? 'active' : ''}`}
              onClick={() => isManagerOrAdmin && onSelectRole(r.id)}
              title={r.desc}
              style={{ cursor: isManagerOrAdmin ? 'pointer' : 'default' }}
            >
              <Icon size={15} />
              <span>{r.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RoleGate;
