import React from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { TEAM_PERMISSION } from '../../../utils/teamAccess';
import PagePermissionDialog from './PagePermissionDialog';
import { PAGE_PERMISSIONS } from './pagePermissions';
import type { UsersAllow } from '../usersAllow';
import type { RoleRecord } from '../types';
import type { RoleEditor } from './useRoleEditor';

export type RolesSectionProps = {
    roles: RoleRecord[];
    editor: RoleEditor;
    allow: UsersAllow;
};

/**
 * Users & Roles → Roles & Permissions: the roles down the left, the selected
 * role's page cards, "People … can manage" for a role with team access, and
 * a card's switches in a dialog.
 */
export default function RolesSection({ roles, editor, allow }: RolesSectionProps) {
    const { selectedRole, editedPermissions, editedManageable, savingPermissions, pagePopup } = editor;
    return (
        <div className="roles-panel-layout">
            {/* Left Roles Sidebar list */}
            <div className="roles-sidebar-list">
                <div className="sidebar-header-row">
                    <h4>Roles</h4>
                    {allow.addRole && (
                        <button className="add-role-btn" onClick={editor.openCreateRole} title="Add Custom Role">
                            <Plus size={16} />
                        </button>
                    )}
                </div>
                <div className="roles-scroll-container">
                    {roles.map(r => (
                        <div 
                            key={r._id} 
                            className={`role-list-item ${selectedRole?._id === r._id ? 'active' : ''}`}
                            onClick={() => editor.selectRole(r)}
                        >
                            <div className="role-item-main">
                                <span className="role-display-name">{r.displayName}</span>
                                <span className="role-system-name">({r.name})</span>
                            </div>
                            {!r.isSystem && allow.deleteRole && (
                                <button 
                                    className="delete-role-btn-icon" 
                                    onClick={(e) => { e.stopPropagation(); editor.deleteRole(r); }}
                                    title="Delete Custom Role"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
            {/* ── RIGHT: Page-based permission cards grid ── */}
            {selectedRole && (
                <div className="permissions-config-panel">
                    <div className="permissions-panel-header">
                        <div>
                            <h3>{selectedRole.displayName} Access Permissions</h3>
                            <p className="subtitle">Click a page card to configure which actions this role can perform.</p>
                        </div>
                        {allow.editRole && (
                            <button 
                                className="save-permissions-btn" 
                                onClick={editor.savePermissions}
                                disabled={savingPermissions}
                            >
                                <Save size={16} />
                                {savingPermissions ? 'Saving...' : 'Save Permissions'}
                            </button>
                        )}
                    </div>

                    <div className="page-permissions-grid">
                        {PAGE_PERMISSIONS.map(pageDef => {
                            const PageIcon = pageDef.icon;
                            const enabledActions = pageDef.actions.filter(a => editedPermissions.includes(a.key));
                            const hasAny = enabledActions.length > 0;

                            return (
                                <div
                                    key={pageDef.id}
                                    className={`page-perm-card ${hasAny ? 'has-access' : ''}`}
                                    onClick={() => editor.openPage(pageDef)}
                                    style={{ '--page-color': pageDef.color } as React.CSSProperties}
                                >
                                    <div className="page-perm-card-header">
                                        <div className="page-icon-wrap" style={{ background: hasAny ? pageDef.color + '22' : undefined }}>
                                            <PageIcon size={20} style={{ color: hasAny ? pageDef.color : undefined }} />
                                        </div>
                                        <div className="page-access-badge">
                                            {hasAny ? `${enabledActions.length} action${enabledActions.length > 1 ? 's' : ''}` : 'No access'}
                                        </div>
                                    </div>
                                    <div className="page-perm-card-title">{pageDef.page}</div>
                                    <div className="page-perm-card-desc">{pageDef.description}</div>
                                    {hasAny && (
                                        <div className="page-perm-action-pills">
                                            {enabledActions.map(a => (
                                                <span key={a.key} className="action-pill" style={{ background: pageDef.color + '33', color: pageDef.color }}>
                                                    {a.label}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <div className="page-perm-edit-hint">Click to edit →</div>
                                </div>
                            );
                        })}
                    </div>

                    {editedPermissions.includes(TEAM_PERMISSION) && !editedPermissions.includes('manage_users') && (
                        <div className="team-roles-panel">
                            <h4>People {selectedRole.displayName} can manage</h4>
                            <p className="subtitle">
                                They see these roles at their own locations, who is online, and can deactivate,
                                reactivate and unlock them. Nobody in a role you leave unticked is reachable.
                            </p>
                            <div className="team-roles-list">
                                {roles.filter(x => x._id !== selectedRole._id && x.name !== 'admin').map(x => (
                                    <label key={x._id} className="team-role-option">
                                        <input
                                            type="checkbox"
                                            checked={editedManageable.includes(x.name)}
                                            onChange={() => editor.toggleManageable(x.name)}
                                        />
                                        {x.displayName}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── PAGE PERMISSION POPUP ── */}
            {pagePopup && (
                <PagePermissionDialog
                    page={pagePopup}
                    roleName={selectedRole?.displayName}
                    editedPermissions={editedPermissions}
                    canEdit={allow.editRole}
                    onToggle={editor.togglePermission}
                    onChange={editor.changePermissions}
                    onClose={editor.closePage}
                />
            )}
        </div>
    );
}
