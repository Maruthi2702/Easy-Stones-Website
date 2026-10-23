import { ClipboardList, Edit2, Eye, MapPin, Phone, Trash2 } from 'lucide-react';
import { momentOf, timeLabel, getLocationBadgeStyle } from './logFormat';
import type { CheckInRowsProps } from './CheckInTable';

/** The Check-In Log on phones and iPads: one card per visitor. */
export default function CheckInCards({
  rows, hasMultipleLocations, badgeTheme, onOpenSheet, onView, onEdit, onDelete,
  hasEditPermission, hasDeletePermission
}: CheckInRowsProps) {
  return (
    <div className="clp-cards-grid clp-mobile-only">
      {rows.map((c) => {
        const moment = momentOf(c);
        const entryIsToday = moment.isToday;
        return (
          <div key={c._id} className={`clp-customer-style-card ${entryIsToday ? 'clp-row-today' : ''}`}>
            {/* Top Row: Visitor Name & Phone (Left) + Status Date Pill & Location (Right) */}
            <div className="clp-csc-top-row">
              <div className="clp-csc-left-info">
                <h3 className="clp-csc-title">{c.name}</h3>
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="clp-csc-badge-pill gold-outline">
                    <Phone size={11} /> {c.phone}
                  </a>
                )}
              </div>
              <div className="clp-csc-right-meta">
                <span className={`clp-csc-status-badge ${entryIsToday ? 'today' : ''}`}>
                  {entryIsToday && <span className="clp-live-pulse-dot" />}
                  {entryIsToday ? `TODAY • ${timeLabel(moment)}` : (moment.date || '-')}
                </span>
                {hasMultipleLocations && c.location && (
                  <span className="clp-csc-badge-pill location-pill" style={getLocationBadgeStyle(c.location, badgeTheme)}>
                    <MapPin size={11} /> {c.location}
                  </span>
                )}
              </div>
            </div>

          {/* Dashed Separator */}
          <div className="clp-csc-dashed-divider" />

          {/* Key-Value Details Block */}
          <div className="clp-csc-details-grid">
            <div className="clp-csc-detail-row">
              <span className="clp-csc-label">Contact / Company:</span>
              <span className="clp-csc-value bold-white">{c.fabricatorCompany || '—'}</span>
            </div>
            <div className="clp-csc-detail-row">
              <span className="clp-csc-label">Customer Phone:</span>
              <span className="clp-csc-value">
                {c.fabricatorPhone ? (
                  <a href={`tel:${c.fabricatorPhone}`} className="clp-csc-phone-link">
                    {c.fabricatorPhone}
                  </a>
                ) : '—'}
              </span>
            </div>
          </div>

          {/* Solid Separator */}
          <div className="clp-csc-solid-divider" />

          {/* Bottom Action Row */}
          <div className="clp-csc-actions-row">
            <div className="clp-csc-actions-left">
              <button
                onClick={() => onOpenSheet(c)}
                className="clp-csc-btn btn-selection"
                title="Selection sheet"
              >
                <ClipboardList size={14} />
                <span>Selection Sheet</span>
                {c.selections && c.selections.length > 0 && (
                  <span className="clp-csc-count-chip">{c.selections.length}</span>
                )}
              </button>
            </div>
            <div className="clp-csc-actions-right">
              {onView && (
                <button
                  onClick={() => onView(c)}
                  className="clp-csc-btn icon-only btn-view"
                  title="View details"
                >
                  <Eye size={14} />
                </button>
              )}
              {onEdit && hasEditPermission && (
                <button
                  onClick={() => onEdit(c)}
                  className="clp-csc-btn icon-only btn-edit"
                  title="Edit check-in"
                >
                  <Edit2 size={14} />
                </button>
              )}
              {onDelete && hasDeletePermission && (
                <button
                  onClick={() => onDelete(c)}
                  className="clp-csc-btn icon-only btn-delete"
                  title="Delete check-in"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      );
    })}
    </div>
  );
}
