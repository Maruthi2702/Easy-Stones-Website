import React from 'react';
import type { FormEvent } from 'react';

export type CreateRoleDialogProps = {
    displayName: string;
    onDisplayName: (displayName: string) => void;
    onSubmit: (e: FormEvent<HTMLFormElement>) => void;
    onClose: () => void;
};

/** Roles & Permissions → + : Create Custom Role (the older modal style). */
export default function CreateRoleDialog({ displayName, onDisplayName, onSubmit, onClose }: CreateRoleDialogProps) {
    return (
        <div className="user-modal-overlay">
            <div className="user-modal-card mini">
                <div className="modal-header">
                    <h3>Create Custom Role</h3>
                    <button className="modal-close-btn" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={onSubmit} className="modal-form">
                    <div className="form-group">
                        <label>Role Display Name</label>
                        <input 
                            type="text" 
                            value={displayName}
                            onChange={(e) => onDisplayName(e.target.value)}
                            placeholder="e.g. Lead Generator"
                            required
                            autoFocus
                        />
                        <span className="input-hint">The system name will be automatically formatted (e.g. <code>lead_generator</code>)</span>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn-primary">Create Role</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
