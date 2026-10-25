import React from 'react';
import { Plus, Trash2, MapPin, UserCheck, ShieldAlert, Info, Eye, Pencil } from 'lucide-react';
import { addressLines } from '../../../utils/locationForm';
import type { UsersAllow } from '../usersAllow';
import type { AdminLocation } from '../types';
import type { LocationActions } from './useLocationActions';

export type LocationsSectionProps = {
    locations: AdminLocation[];
    actions: LocationActions;
    allow: UsersAllow;
};

/** Users & Roles → Locations: Add location, the no-address banner, messages and the list. */
export default function LocationsSection({ locations, actions, allow }: LocationsSectionProps) {
    const { locationsMissingAddress, locationError, locationSuccess, setLocationForm } = actions;
    return (
        <div className="locations-panel-layout">
            {allow.addLocation && (
                <div className="panel-actions-toolbar" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="add-user-btn" onClick={() => setLocationForm('new')} style={{ whiteSpace: 'nowrap' }}>
                        <Plus size={18} />
                        <span>Add location</span>
                    </button>
                </div>
            )}

            {locationsMissingAddress.length > 0 && (
                <div className="location-missing-banner" role="status">
                    <Info size={16} aria-hidden="true" />
                    <span>
                        {locationsMissingAddress.length === 1
                            ? `${locationsMissingAddress[0].name} has no address yet.`
                            : `${locationsMissingAddress.length} locations have no address yet.`}
                        {' '}Their selection sheets print the Kent address until one is added.
                    </span>
                </div>
            )}

            {locationError && (
                <div className="profile-message-banner error">
                    <ShieldAlert size={16} />
                    <span>{locationError}</span>
                </div>
            )}

            {locationSuccess && (
                <div className="profile-message-banner success">
                    <UserCheck size={16} />
                    <span>{locationSuccess}</span>
                </div>
            )}

            <div className="users-table-wrapper">
                <table className="users-table">
                    <thead>
                        <tr>
                            <th>Location</th>
                            <th>Address</th>
                            <th>Primary contact</th>
                            <th>Region · RDC</th>
                            <th style={{ width: '110px', textAlign: 'center' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {locations.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="empty-table-row">
                                    No locations found. Add one above!
                                </td>
                            </tr>
                        ) : (
                            locations.map(loc => {
                                const pc = loc.primaryContact || {};
                                const lines = addressLines(pc.address || {});
                                const rdc = locations.find((l) => l.name === loc.rdc);
                                const types = [loc.profitCenter && 'Profit center', loc.warehouse && 'Warehouse'].filter(Boolean) as string[];
                                return (
                                    <tr key={loc._id}>
                                        <td>
                                            <div className="username-cell">
                                                <div className="avatar-small location-avatar">
                                                    <MapPin size={16} />
                                                </div>
                                                <div className="location-cell-stack">
                                                    <span className="location-name-text">{loc.fullName || loc.name}</span>
                                                    <span className="location-sub">
                                                        {loc.fullName ? loc.name : null}
                                                        {loc.shortCode && <span className="location-code-badge">{loc.shortCode}</span>}
                                                    </span>
                                                    {types.length > 0 && (
                                                        <span className="location-types">
                                                            {types.map((t) => <span key={t} className="location-type-chip">{t}</span>)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td data-label="Address">
                                            {lines.length > 0 ? (
                                                <div className="location-cell-stack">
                                                    {lines.map((line) => <span key={line}>{line}</span>)}
                                                </div>
                                            ) : (
                                                <span className="location-missing-chip">No address yet</span>
                                            )}
                                        </td>
                                        <td data-label="Primary contact">
                                            {pc.name || pc.phone || pc.email ? (
                                                <div className="location-cell-stack">
                                                    {pc.name && <span>{pc.name}</span>}
                                                    {pc.phone && <span className="location-sub">{pc.phone}</span>}
                                                    {pc.email && <span className="location-sub">{pc.email}</span>}
                                                </div>
                                            ) : (
                                                <span className="location-code-empty">Not set</span>
                                            )}
                                        </td>
                                        <td data-label="Region · RDC">
                                            {loc.region || loc.rdc ? (
                                                <div className="location-cell-stack">
                                                    {loc.region && <span>{loc.region}</span>}
                                                    {loc.rdc && <span className="location-sub">RDC: {rdc?.fullName || loc.rdc}</span>}
                                                </div>
                                            ) : (
                                                <span className="location-code-empty">Not set</span>
                                            )}
                                        </td>
                                        <td>
                                            <div className="action-buttons-cell" style={{ justifyContent: 'center' }}>
                                                <button
                                                    type="button"
                                                    className="action-icon-btn"
                                                    onClick={() => setLocationForm(loc)}
                                                    title={allow.editLocation ? `Edit ${loc.name}` : `View ${loc.name}`}
                                                    aria-label={allow.editLocation ? `Edit ${loc.name}` : `View ${loc.name}`}
                                                >
                                                    {allow.editLocation ? <Pencil size={16} /> : <Eye size={16} />}
                                                </button>
                                                {allow.deleteLocation && (
                                                    <button
                                                        type="button"
                                                        className="action-icon-btn delete"
                                                        onClick={() => actions.deleteLocation(loc)}
                                                        title={`Delete ${loc.name}`}
                                                        aria-label={`Delete ${loc.name}`}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
