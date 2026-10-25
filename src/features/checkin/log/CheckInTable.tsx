import { ClipboardList, Edit2, Eye, MoreHorizontal, Phone, Settings, Trash2, Building2, X } from 'lucide-react';
import type { Loose } from '../../../types/records';
import { momentOf, timeLabel, getInitials, getAvatarColor, getLocationBadgeStyle } from './logFormat';

export type CheckInRowsProps = {
  rows: Loose[];
  hasMultipleLocations: boolean;
  /** The theme the branch badges are coloured for. */
  badgeTheme: string | null;
  onOpenSheet: (checkIn: Loose) => void;
  onView: ((checkIn: Loose) => void) | null;
  onEdit: ((checkIn: Loose) => void) | null;
  onDelete: ((checkIn: Loose) => void) | null;
  hasEditPermission: boolean;
  hasDeletePermission: boolean;
};

/**
 * The Check-In Log on laptops and desktops: a table. A row's View / Edit /
 * Delete sit behind its ⋯ — one row open at a time (`expandedActionsId`, held
 * by the panel).
 */
export default function CheckInTable({
  rows, hasMultipleLocations, badgeTheme, onOpenSheet, onView, onEdit, onDelete,
  hasEditPermission, hasDeletePermission, expandedActionsId, setExpandedActionsId
}: CheckInRowsProps & { expandedActionsId: string | null; setExpandedActionsId: (id: string | null) => void }) {
  return (
    <div className="clp-table-scroll clp-desktop-only">
      <table className="clp-table">
        <thead>
          <tr>
            <th className="clp-th">CHECK-IN TIME</th>
            <th className="clp-th">VISITOR NAME</th>
            <th className="clp-th clp-th-group-end">PHONE NUMBER</th>
            <th className="clp-th">COMPANY/CONTACT NAME</th>
            <th className="clp-th clp-th-group-end">CUSTOMER PHONE</th>
            {hasMultipleLocations && <th className="clp-th clp-th-group-end">LOCATION</th>}
            <th className="clp-th" style={{ textAlign: 'center' }}>
              <span className="clp-th-actions">
                <Settings size={13} />
                ACTIONS
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const moment = momentOf(c);
            const entryIsToday = moment.isToday;
            return (
              <tr key={c._id} className={entryIsToday ? 'clp-row-today' : ''}>
                <td className="clp-td-time">
                  <div className="clp-date">{moment.date || '-'}</div>
                  <div className="clp-time">{timeLabel(moment)}</div>
                  {entryIsToday && <span className="clp-badge clp-badge-today">Today</span>}
                </td>
                <td>
                  <div className="clp-visitor-row">
                    <div
                      className="clp-avatar"
                      style={{
                        background: `linear-gradient(135deg, ${getAvatarColor(c.name)}, ${getAvatarColor(c.name)}99)`,
                      }}
                    >
                      {getInitials(c.name)}
                    </div>
                    <span className="clp-visitor-name">{c.name}</span>
                  </div>
                </td>
                <td>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="clp-icon-text clp-phone-link">
                      <Phone size={12} /> {c.phone}
                    </a>
                  ) : (
                    <span className="clp-dash">—</span>
                  )}
                </td>
                <td>
                  {c.fabricatorCompany ? (
                    <div className="clp-company-row">
                      <div className="clp-company-icon">
                        <Building2 size={13} />
                      </div>
                      <span className="clp-company-name">{c.fabricatorCompany}</span>
                    </div>
                  ) : (
                    <span className="clp-dash">—</span>
                  )}
                </td>
                <td>
                  {c.fabricatorPhone ? (
                    <a href={`tel:${c.fabricatorPhone}`} className="clp-icon-text clp-phone-link">
                      <Phone size={12} /> {c.fabricatorPhone}
                    </a>
                  ) : (
                    <span className="clp-dash">—</span>
                  )}
                </td>
                {hasMultipleLocations && (
                  <td>
                    {c.location ? (
                      <span style={{
                        ...getLocationBadgeStyle(c.location, badgeTheme),
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '0.72rem',
                        fontWeight: '600',
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase'
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                        {c.location}
                      </span>
                    ) : (
                      <span className="clp-dash">—</span>
                    )}
                  </td>
                )}

                <td>
                  <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      onClick={() => onOpenSheet(c)}
                      title="Selection sheet"
                      style={{ background: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}
                    >
                      <ClipboardList size={15} />
                      {c.selections && c.selections.length > 0 && (
                        <span className="clp-csc-count-chip">{c.selections.length}</span>
                      )}
                    </button>
                    {(onView || (onEdit && hasEditPermission) || (onDelete && hasDeletePermission)) && (
                      expandedActionsId === c._id ? (
                        <>
                          <span className="clp-actions-divider" />
                          {onView && (
                            <button
                              onClick={() => { onView(c); setExpandedActionsId(null); }}
                              title="View details"
                              style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          {onEdit && hasEditPermission && (
                            <button
                              onClick={() => { onEdit(c); setExpandedActionsId(null); }}
                              title="Edit check-in"
                              style={{ background: 'transparent', border: 'none', color: '#d4af37', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                            >
                              <Edit2 size={15} />
                            </button>
                          )}
                          {onDelete && hasDeletePermission && (
                            <button
                              onClick={() => { onDelete(c); setExpandedActionsId(null); }}
                              title="Delete check-in"
                              style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedActionsId(null)}
                            title="Collapse"
                            aria-label="Collapse actions"
                            className="clp-actions-collapse-btn"
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setExpandedActionsId(c._id)}
                          title="More actions"
                          aria-label="More actions"
                          className="clp-actions-toggle-btn"
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
