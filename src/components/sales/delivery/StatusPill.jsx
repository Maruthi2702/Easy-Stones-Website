import React from 'react';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

const StatusPill = ({ status = 'pending', size = 'normal' }) => {
  const getStatusDetails = () => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'delivered':
        return {
          label: 'Completed',
          icon: CheckCircle2,
          className: 'pill-status-completed',
          color: '#2F8F73'
        };
      case 'delayed':
      case 'running_late':
        return {
          label: 'Delayed',
          icon: AlertTriangle,
          className: 'pill-status-delayed',
          color: '#E1602A'
        };
      case 'pending':
        return {
          label: 'Pending',
          icon: Clock,
          className: 'pill-status-pending',
          color: '#f59e0b'
        };
      case 'scheduled':
      default:
        return {
          label: 'Scheduled',
          icon: Clock,
          className: 'pill-status-scheduled',
          color: '#D4AF37'
        };
    }
  };

  const { label, icon: Icon, className } = getStatusDetails();

  return (
    <span className={`manifest-status-pill ${className} ${size}`}>
      <Icon size={size === 'small' ? 12 : 14} />
      <span>{label}</span>
    </span>
  );
};

export default StatusPill;
