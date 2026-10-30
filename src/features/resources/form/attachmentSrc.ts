import { API_URL } from '../../../config/api';

/** Where a resource's photo or PDF loads from: data: and http(s) as they are, old uploads from the server. */
export const attachmentSrc = (src: string): string => {
    if (!src) return '';
    if (src.startsWith('data:') || src.startsWith('http')) return src;
    if (src.includes('uploads/')) return `${API_URL}${src.startsWith('/') ? '' : '/'}${src}`;
    return `${API_URL}/uploads/resources/${src}`;
};

/** A resource's attachments as a list, whichever way it was saved (array, JSON text, or comma-separated). */
export const attachmentList = (data: unknown): string[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(Boolean).map(String);
    if (typeof data === 'string' && data.trim() !== '') {
        if (data.startsWith('[') && data.endsWith(']')) {
            try {
                return (JSON.parse(data) as unknown[]).filter(Boolean).map(String);
            } catch {
                return data.split(',').map((s) => s.trim()).filter(Boolean);
            }
        }
        return data.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
};
