import React from 'react';
import { Check } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection } from '../../../components/shared/form/FormControls';
import { groupBySection, fullAccessOn, listedActions, setAllIn } from './permissionGroups';
import type { PageDef } from '../types';

export type PagePermissionDialogProps = {
    page: PageDef;
    roleName?: string;
    editedPermissions: string[];
    /** Edit roles: without it the switches are read-only. */
    canEdit: boolean;
    onToggle: (key: string) => void;
    onChange: (change: (prev: string[]) => string[]) => void;
    onClose: () => void;
};

/** Roles & Permissions → a page card: its switches by section, "Turn all on / off". */
export default function PagePermissionDialog({ page, roleName, editedPermissions, canEdit, onToggle, onChange, onClose }: PagePermissionDialogProps) {
    // Group the card's switches by section. A switch implied by another
    // that is on (Full access) isn't listed: one note instead.
    const groups = groupBySection(page.actions);
    const fullOn = fullAccessOn(page.actions, editedPermissions);
    return (
        <FormModal
            title={<>{page.page} <span className="fm-title-sub">· {roleName}</span></>}
            size="m"
            onClose={onClose}
            onSubmit={onClose}
            submitLabel="Done"
        >
            {groups.map(group => {
                const listed = listedActions(group, fullOn);
                if (listed.length === 0) return null;
                const onCount = listed.filter(x => editedPermissions.includes(x.key)).length;
                const setAll = (on: boolean) => onChange(prev => setAllIn(prev, listed, on));
                return (
                    <FormSection key={group.section || 'main'} title={group.section}>
                        {group.section && listed.length > 1 && (
                            <div className="perm-form-tools">
                                <span>{onCount} of {listed.length} on</span>
                                {canEdit && (
                                    <button type="button" onClick={() => setAll(onCount !== listed.length)}>
                                        {onCount === listed.length ? 'Turn all off' : 'Turn all on'}
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="perm-form-list">
                            {listed.map(action => {
                                const isEnabled = editedPermissions.includes(action.key);
                                return (
                                    <button
                                        key={action.key}
                                        type="button"
                                        role="checkbox"
                                        aria-checked={isEnabled}
                                        disabled={!canEdit}
                                        className="perm-form-row"
                                        onClick={() => onToggle(action.key)}
                                    >
                                        <span className="fm-check"><Check size={12} strokeWidth={3.2} aria-hidden="true" /></span>
                                        <span className="perm-form-text">
                                            <span className="perm-form-label">{action.label}</span>
                                            <span className="perm-form-desc">{action.desc}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {group.section === 'Everything' && fullOn && (
                            <div className="fm-note-box">
                                Full access includes every Users, Roles & Permissions, Locations and Side nav action, now and any added later. Turn it off to pick actions one by one.
                            </div>
                        )}
                    </FormSection>
                );
            })}
        </FormModal>
    );
}
