import { X } from 'lucide-react';

export type AddFolderModalProps = {
    name: string;
    onNameChange: (name: string) => void;
    onCreate: () => void;
    onClose: () => void;
};

/** Team Files → Add Folder. */
export default function AddFolderModal({ name, onNameChange, onCreate, onClose }: AddFolderModalProps) {
    return (
        <div className="modal-overlay" onClick={() => onClose()}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create New Folder</h2>
                    <button className="close-btn" onClick={() => onClose()}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>Folder Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="Enter folder name"
                            autoFocus
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => onClose()}>Cancel</button>
                    <button className="btn-primary" onClick={() => { onCreate(); onClose(); }}>Create</button>
                </div>
            </div>
        </div>
    );
}
