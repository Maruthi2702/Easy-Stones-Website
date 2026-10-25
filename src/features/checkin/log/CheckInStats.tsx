import { Calendar, UserCheck, Users } from 'lucide-react';

/** The Check-In Log's counts: today, this month, all time. */
export default function CheckInStats({ todayCount, monthCount, allTimeCount }: { todayCount: number; monthCount: number; allTimeCount: number }) {
  return (
    <div className="clp-stats">
      <div className="clp-stat">
        <div className="clp-stat-icon clp-stat-green">
          <UserCheck size={16} />
        </div>
        <div>
          <div className="clp-stat-val">{todayCount}</div>
          <div className="clp-stat-lbl">Today's Visitors</div>
        </div>
      </div>
      <div className="clp-stat-divider" />
      <div className="clp-stat">
        <div className="clp-stat-icon clp-stat-blue">
          <Calendar size={16} />
        </div>
        <div>
          <div className="clp-stat-val">{monthCount}</div>
          <div className="clp-stat-lbl">{new Date().toLocaleString('default', { month: 'long' })} Visitors</div>
        </div>
      </div>
      <div className="clp-stat-divider" />
      <div className="clp-stat">
        <div className="clp-stat-icon clp-stat-gold">
          <Users size={16} />
        </div>
        <div>
          <div className="clp-stat-val">{allTimeCount}</div>
          <div className="clp-stat-lbl">All-Time Visitors</div>
        </div>
      </div>
    </div>
  );
}
