import { X } from 'lucide-react';
import type { TeamFileForm } from './useTeamFiles';

export type TeamFileUploadModalProps = {
    form: TeamFileForm;
    onChange: (form: TeamFileForm) => void;
    onUpload: (e: { preventDefault: () => void }) => void;
    onClose: () => void;
};

/** Team Files → Upload (and Edit): a file or a link, by name. */
export default function TeamFileUploadModal({ form, onChange, onUpload, onClose }: TeamFileUploadModalProps) {
    return (
        <div className="modal-overlay" onClick={() => onClose()}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Upload Dashboard Resource</h2>
                    <button className="close-btn" onClick={() => onClose()}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>Resource Name</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => onChange({ ...form, name: e.target.value })}
                            placeholder="Enter resource name"
                        />
                    </div>
                    <div className="form-group">
                        <label>Type</label>
                        <select
                            value={form.type}
                            onChange={(e) => onChange({ ...form, type: e.target.value })}
                            className="form-select"
                        >
                            <option value="file">File</option>
                            <option value="link">Link</option>
                        </select>
                    </div>
                    {form.type === 'link' ? (
                        <div className="form-group">
                            <label>URL</label>
                            <input
                                type="url"
                                value={form.content || ''}
                                onChange={(e) => onChange({ ...form, content: e.target.value })}
                                placeholder="https://example.com"
                            />
                        </div>
                    ) : (
                        <div className="form-group">
                            <label>File</label>
                            <input
                                type="file"
                                onChange={(e) => onChange({ ...form, file: e.target.files![0] })}
                            />
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => onClose()}>Cancel</button>
                    <button className="btn-primary" onClick={onUpload}>Upload</button>
                </div>
            </div>
        </div>
    );
}
