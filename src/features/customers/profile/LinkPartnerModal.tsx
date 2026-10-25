import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import SearchableSelect from '../../../components/SearchableSelect';

export type LinkPartnerModalProps = {
    /** Customers that can be linked (not this one, not already linked). */
    options: { value: string; label: string }[];
    value: string;
    onChange: (partnerId: string) => void;
    loading: boolean;
    linking: boolean;
    onSubmit: (e?: FormEvent) => void;
    onClose: () => void;
};

/** Customer profile → Network → Link Partner. */
export default function LinkPartnerModal({ options, value, onChange, loading, linking, onSubmit, onClose }: LinkPartnerModalProps) {
    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '500px', minHeight: '300px', overflow: 'visible' }}>
                <div className="modal-header" style={{ borderRadius: '12px 12px 0 0' }}>
                    <h2>LINK PARTNER</h2>
                    <button
                        type="button"
                        className="close-btn"
                        onClick={onClose}
                    >
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'visible' }}>
                    <div className="modal-body" style={{ overflow: 'visible' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>Select Partner to Link</label>
                            <SearchableSelect
                                options={options}
                                value={value}
                                onChange={(val: string) => onChange(val)}
                                placeholder="Search by company or contact name..."
                                isLoading={loading}
                            />
                        </div>
                    </div>
                    <div className="modal-footer" style={{ borderRadius: '0 0 12px 12px' }}>
                        <button
                            type="button"
                            className="btn-secondary"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={!value || linking}
                        >
                            {linking ? 'Linking...' : 'Link Partner'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
