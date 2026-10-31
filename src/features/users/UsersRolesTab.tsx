import React from 'react';
import { Users, ShieldAlert, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { hasTeamUserAccess } from '../../utils/teamAccess';
// The sections and dialogs in the order their stylesheets have always loaded:
// RowMenu (the Users list), FormModal and FormControls (a Roles page card),
// then LocationForm, AddUserForm, EditUserForm, and this page's own CSS last.
import UsersSection from './userList/UsersSection';
import RolesSection from './roles/RolesSection';
import LocationsSection from './locations/LocationsSection';
import LocationForm from './locations/LocationForm';
import AddUserForm from './userForm/AddUserForm';
import EditUserForm from './userForm/EditUserForm';
import CreateRoleDialog from './roles/CreateRoleDialog';
import { describeRole, isDriverRole } from './roles/pagePermissions';
import { useUsersData } from './useUsersData';
import { usePresence } from './userList/usePresence';
import { useUserFilter } from './userList/useUserFilter';
import { useUserActions } from './userList/useUserActions';
import { useRoleEditor } from './roles/useRoleEditor';
import { useLocationActions } from './locations/useLocationActions';
import { usersAllow } from './usersAllow';
import type { LucideIcon } from 'lucide-react';
import type { AdminLocation } from './types';
import './UsersRolesTab.css';

// One of three admin-rail pages: section is 'users', 'roles' or 'locations'
// (SalesPage picks it from the side nav).
const SECTION_TITLES: Record<string, { title: string; icon: LucideIcon }> = {
    users: { title: 'Users', icon: Users },
    roles: { title: 'Roles & Permissions', icon: ShieldAlert },
    locations: { title: 'Locations', icon: MapPin }
};

export type UsersRolesSection = 'users' | 'roles' | 'locations';

export type UsersRolesTabProps = {
    section?: UsersRolesSection | string;
    sidebarToggle?: React.ReactNode;
    /** The shell's locations list (GET /api/admin/locations). */
    locations?: AdminLocation[];
    /** Reloads that list after an add, edit or delete. */
    fetchLocations?: () => void;
};

/**
 * Users & Roles: the Users, Roles & Permissions and Locations pages (one
 * screen, `section` picks which), with Add / Edit user, Add / Edit location
 * and Create Custom Role. The lists load once per page (useUsersData); each
 * section's actions are their own hooks.
 */
const UsersRolesTab = ({ section = 'users', sidebarToggle, locations = [], fetchLocations }: UsersRolesTabProps) => {
    const subTab = section;
    const { user: me } = useAuth();
    // A manager with team access: sees their own people and can only
    // deactivate, reactivate and unlock them (src/utils/teamAccess.ts).
    const teamMode = hasTeamUserAccess(me);
    // What this person may do on these pages, one switch per action.
    const allow = usersAllow(me, teamMode);

    const locationActions = useLocationActions(locations, fetchLocations);
    const { locationForm, setLocationForm } = locationActions;
    const live = usePresence();
    // The role shown first is picked when the roles load; roleEditor is set
    // by then (the load answers after this render).
    const data = useUsersData({ section, me, teamMode, onRolesLoaded: (role) => roleEditor.selectRole(role) });
    const { users, roles, loading, error } = data;
    const roleEditor = useRoleEditor(roles, data.setRoles);
    const filter = useUserFilter(users, live);
    const userActions = useUserActions({ setUsers: data.setUsers, reload: data.reload });

    return (
        <div className="users-roles-container">
            <div className="users-roles-header" style={{ gap: '1.25rem' }}>
                {sidebarToggle}
                <h2 className="users-roles-title">
                    {React.createElement(SECTION_TITLES[section]?.icon || Users, { size: 20 })}
                    {SECTION_TITLES[section]?.title || 'Users'}
                </h2>
            </div>

            {loading ? (
                <div className="loading-state">
                    <div className="loader-spinner"></div>
                    <span>Loading users & permissions...</span>
                </div>
            ) : error ? (
                <div className="error-state">
                    <ShieldAlert size={48} color="#ef4444" />
                    <h3>Access Restricted</h3>
                    <p>{error}</p>
                </div>
            ) : (
                <div className="sub-tab-content">
                    {subTab === 'users' && (
                        <UsersSection users={users} roles={roles} live={live} filter={filter} actions={userActions} allow={allow} teamMode={teamMode} />
                    )}
                    {subTab === 'roles' && <RolesSection roles={roles} editor={roleEditor} allow={allow} />}
                    {subTab === 'locations' && <LocationsSection locations={locations} actions={locationActions} allow={allow} />}
                </div>
            )}

            {locationForm && (
                <LocationForm
                    location={locationForm === 'new' ? null : locationForm}
                    locations={locations}
                    users={users}
                    onClose={() => setLocationForm(null)}
                    onSaved={(saved) => locationActions.locationSaved(saved, locationForm === 'new')}
                    onDelete={allow.deleteLocation ? locationActions.deleteLocation : undefined}
                    readOnly={!allow.editLocation}
                />
            )}

            {userActions.showAddUser && (
                <AddUserForm
                    roles={roles}
                    locations={locations}
                    describeRole={describeRole}
                    isDriverRole={isDriverRole}
                    onClose={userActions.closeAddUser}
                    onCreated={userActions.userCreated}
                />
            )}

            {userActions.editingUser && (
                <EditUserForm
                    user={userActions.editingUser}
                    roles={roles}
                    locations={locations}
                    describeRole={describeRole}
                    onClose={userActions.closeEditUser}
                    onSaved={userActions.userSaved}
                    onChangeAccess={userActions.changeUserAccess}
                    access={{ edit: allow.editUser, resetSignIn: allow.resetSignIn, unlock: allow.unlock, deactivate: allow.deactivate }}
                />
            )}

            {/* ── MODAL: CREATE ROLE ── */}
            {roleEditor.showRoleModal && (
                <CreateRoleDialog
                    displayName={roleEditor.roleForm.displayName}
                    onDisplayName={(displayName) => roleEditor.setRoleForm(prev => ({ ...prev, displayName }))}
                    onSubmit={roleEditor.createRole}
                    onClose={roleEditor.closeCreateRole}
                />
            )}
        </div>
    );
};

export default UsersRolesTab;
