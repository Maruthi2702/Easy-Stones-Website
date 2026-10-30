import { Download, ExternalLink, File, FileImage, FileText, Folder, Link, X } from 'lucide-react';
import { API_URL } from '../../config/api';
import { formatDate } from '../../utils/dateUtils';
import { openPdfInline } from '../../utils/packingList';
import type { Loose } from '../../types/records';

export type TeamFilePreviewProps = {
    resource: Loose;
    onClose: () => void;
    onDownload: (resource: Loose) => void;
};

/** The Team Files pop-up that shows one file (image, PDF) or link. */
export default function TeamFilePreview({ resource, onClose, onDownload }: TeamFilePreviewProps) {
    return (
        <div className="modal-overlay preview-overlay" onClick={() => onClose()}>
            <div className="modal-content preview-modal-content dark-theme" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header preview-header premium-header">
                    <div className="preview-file-info">
                        <div className="preview-icon-badge">
                            {resource.type === 'folder' ? <Folder size={20} className="text-gold" /> :
                                resource.type === 'link' ? <Link size={20} className="text-blue" /> :
                                    (resource.contentType?.startsWith('image/') || resource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? <FileImage size={20} className="text-purple" /> :
                                        (resource.contentType === 'application/pdf' || resource.name.toLowerCase().endsWith('.pdf')) ? <FileText size={20} className="text-red" /> :
                                            <File size={20} className="text-gray" />}
                        </div>
                        <div className="preview-details">
                            <h2 className="preview-title" title={resource.name}>{resource.name}</h2>
                            <div className="preview-meta-row">
                                <span className="preview-type-tag">{resource.type.toUpperCase()}</span>
                                <span className="preview-separator">•</span>
                                <span className="preview-date">{formatDate(resource.createdAt)}</span>
                            </div>
                        </div>
                    </div>
                    <div className="preview-actions">
                        <a
                            href={resource.content.startsWith('http') || resource.content.startsWith('data:') ? resource.content : `${API_URL}${resource.content}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="icon-btn-ghost preview-action-btn"
                            title="Open in New Tab"
                            onClick={(e) => {
                                const c = resource.content || '';
                                const isPdf = c.startsWith('data:application/pdf') || resource.contentType === 'application/pdf' || /\.pdf$/i.test(resource.name || '');
                                if (!isPdf) return;
                                e.preventDefault();
                                openPdfInline(c.startsWith('http') || c.startsWith('data:') ? c : `${API_URL}${c}`);
                            }}
                        >
                            <ExternalLink size={20} />
                        </a>
                        <button
                            className="icon-btn-ghost preview-action-btn"
                            title="Download"
                            onClick={() => onDownload(resource)}
                        >
                            <Download size={20} />
                        </button>
                        <button className="close-preview-btn premium-close" onClick={() => onClose()}>
                            <X size={24} />
                        </button>
                    </div>
                </div>
                <div className="modal-body preview-body">
                    {resource.type === 'file' ? (
                        (resource.content?.startsWith('data:image') ||
                            (!resource.content?.startsWith('data:') &&
                                (resource.contentType?.startsWith('image/') ||
                                    resource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)))) ? (
                            <div className="image-preview-container">
                                <img
                                    src={resource.content.startsWith('http') || resource.content.startsWith('data:') ? resource.content : `${API_URL}${resource.content}`}
                                    alt={resource.name}
                                    className="preview-image"
                                    loading="lazy"
                                />
                            </div>
                        ) : (resource.content?.startsWith('data:application/pdf') ||
                            (!resource.content?.startsWith('data:') &&
                                (resource.contentType === 'application/pdf' ||
                                    resource.name.toLowerCase().endsWith('.pdf')))) ? (
                            <div className="pdf-preview-container">
                                <object
                                    data={`${resource.content.startsWith('http') || resource.content.startsWith('data:') ? resource.content : `${API_URL}${resource.content}`}#toolbar=0`}
                                    type="application/pdf"
                                    className="preview-iframe"
                                    width="100%"
                                    height="100%"
                                >
                                    <div className="no-preview-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                        <p>Unable to display PDF preview.</p>
                                        <button className="btn-primary small" onClick={() => onDownload(resource)}>
                                            Download PDF
                                        </button>
                                    </div>
                                </object>
                            </div>
                        ) : (
                            <div className="no-preview-container">
                                <File size={64} className="no-preview-icon" />
                                <p>No preview available for this file type</p>
                                <button className="btn-primary small" onClick={() => onDownload(resource)}>
                                    Download to View
                                </button>
                            </div>
                        )
                    ) : (
                        <div className="link-preview-container">
                            <Link size={48} />
                            <p>This is a web link</p>
                            <a href={resource.content} target="_blank" rel="noopener noreferrer" className="btn-primary">
                                Open in New Tab
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
