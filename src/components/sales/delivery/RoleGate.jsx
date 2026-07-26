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

const RoleGate = ({ currentRole, onSelectRole }) => {
  return (
    <div className="manifest-role-bar">
      <div className="role-selector-pills">
        <span className="role-bar-label">Active Manifest Mode:</span>
        {ROLES.map(r => {
          const Icon = r.icon;
          const isActive = currentRole === r.id;
          return (
            <button
              key={r.id}
              type="button"
              className={`role-pill-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectRole(r.id)}
              title={r.desc}
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
