import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import LocationPicker from '../../components/shared/form/LocationPicker';
import { formatPhoneInput } from '../../utils/phoneUtils';
import type { CheckInLog } from './useCheckInLog';

/**
 * One check-in, read-only ('view') or with its visitor details editable
 * ('edit'). Moved out of SalesPage unchanged (2026-10-23): same markup and
 * styles. Shown while `log.selected` and `log.mode` are set.
 */
export type CheckInDetailModalProps = {
    log: CheckInLog;
    /** Branch names (or Location documents) the Branch picker offers. */
    locations: unknown[];
    currentUser: unknown;
};

export default function CheckInDetailModal({ log, locations, currentUser }: CheckInDetailModalProps) {
    if (!log.selected || !log.mode) return null;
    return createPortal(
        <div className="modal-overlay" onClick={() => { log.close(); }}>
            <div className="modal-content animate-slide-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px', background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="modal-header" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {log.mode === 'view' ? 'Check-In Details' : 'Edit Check-In'}
                    </h2>
                    <button className="close-btn" onClick={() => { log.close(); }} style={{ color: 'var(--text-secondary)' }}>
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={log.save}>
                    <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem', maxHeight: '70vh', overflowY: 'auto' }}>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Visitor Name <span style={{ color: 'var(--status-danger, #ef4444)' }}>*</span></label>
                            <input
                                type="text"
                                value={log.mode === 'view' ? (log.selected!.name || '') : log.form.name}
                                onChange={(e) => log.setForm({ ...log.form, name: e.target.value })}
                                readOnly={log.mode === 'view'}
                                placeholder="e.g. John Doe"
                                required
                                style={{ width: '100%', padding: '0.75rem 0.95rem', borderRadius: '8px', background: log.mode === 'view' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: log.mode === 'view' ? 'rgba(255,255,255,0.7)' : '#fff', fontSize: '0.9rem', outline: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Phone Number <span style={{ color: 'var(--status-danger, #ef4444)' }}>*</span></label>
                            <input
                                type="text"
                                value={log.mode === 'view' ? (log.selected!.phone || '') : log.form.phone}
                                onChange={(e) => log.setForm({ ...log.form, phone: formatPhoneInput(e.target.value) })}
                                readOnly={log.mode === 'view'}
                                placeholder="e.g. (555) 000-0000"
                                required
                                style={{ width: '100%', padding: '0.75rem 0.95rem', borderRadius: '8px', background: log.mode === 'view' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: log.mode === 'view' ? 'rgba(255,255,255,0.7)' : '#fff', fontSize: '0.9rem', outline: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Company/Contact Name <span style={{ color: 'var(--status-danger, #ef4444)' }}>*</span></label>
                            <input
                                type="text"
                                value={log.mode === 'view' ? (log.selected!.fabricatorCompany || '') : log.form.fabricatorCompany}
                                onChange={(e) => log.setForm({ ...log.form, fabricatorCompany: e.target.value })}
                                readOnly={log.mode === 'view'}
                                placeholder="e.g. Premier Builders / Jane Smith"
                                required
                                style={{ width: '100%', padding: '0.75rem 0.95rem', borderRadius: '8px', background: log.mode === 'view' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: log.mode === 'view' ? 'rgba(255,255,255,0.7)' : '#fff', fontSize: '0.9rem', outline: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Company Phone Number <span style={{ color: 'var(--status-danger, #ef4444)' }}>*</span></label>
                            <input
                                type="text"
                                value={log.mode === 'view' ? (log.selected!.fabricatorPhone || '') : log.form.fabricatorPhone}
                                onChange={(e) => log.setForm({ ...log.form, fabricatorPhone: formatPhoneInput(e.target.value) })}
                                readOnly={log.mode === 'view'}
                                placeholder="e.g. (555) 000-0000"
                                required
                                style={{ width: '100%', padding: '0.75rem 0.95rem', borderRadius: '8px', background: log.mode === 'view' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: log.mode === 'view' ? 'rgba(255,255,255,0.7)' : '#fff', fontSize: '0.9rem', outline: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Branch Location <span style={{ color: 'var(--status-danger, #ef4444)' }}>*</span></label>
                            {log.mode === 'view' ? (
                                <input
                                    type="text"
                                    value={log.selected!.location || 'Seattle'}
                                    readOnly
                                    style={{ width: '100%', padding: '0.75rem 0.95rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', outline: 'none' }}
                                />
                            ) : (
                                <LocationPicker
                                    id="sp-checkin-location"
                                    value={log.form.location || ''}
                                    onChange={(location) => log.setForm({ ...log.form, location })}
                                    options={locations.length > 0 ? locations : ['Seattle', 'Spokane', 'Salt Lake City']}
                                    user={currentUser}
                                    sheetTitle="Branch location"
                                />
                            )}
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Logged By</label>
                            <input
                                type="text"
                                value={
                                    typeof log.selected!.loggedBy === 'string' && log.selected!.loggedBy.trim()
                                        ? log.selected!.loggedBy
                                        : log.selected!.loggedBy?.displayName || log.selected!.loggedBy?.username || (log.selected!.isSelfCheckIn || log.selected!.source === 'self' || log.selected!.loggedBy === 'Self Check-In (QR/NFC)' ? '📱 Self Check-In (QR/NFC)' : 'Staff')
                                }
                                readOnly
                                disabled
                                style={{ width: '100%', padding: '0.75rem 0.95rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', outline: 'none', cursor: 'not-allowed' }}
                            />
                        </div>
                    </div>
                    <div className="modal-footer" style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                        <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => { log.close(); }}
                            style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.875rem' }}
                        >
                            Close
                        </button>
                        {log.mode === 'edit' && (
                            <button
                                type="submit"
                                className="btn-primary"
                                style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', cursor: 'pointer', background: 'linear-gradient(135deg, #d4af37, #b8961f)', color: '#000', border: 'none', fontWeight: 700, fontSize: '0.875rem' }}
                            >
                                Save Changes
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
