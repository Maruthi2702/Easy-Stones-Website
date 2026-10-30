/**
 * Team Files' rules (2026-10-30), shared by the server (src/routes/teamFiles.js)
 * and the page (src/features/teamFiles/). Design: the claude.ai artifact
 * **Team Files Page Canvas** (https://claude.ai/artifact/NRBYg5zf4Ycw8NCuMrpd97).
 *
 * Items are SalesDashboardResource records: a folder (`isFolder`), a file
 * (`type: 'file'`, `content` a Cloudinary URL or /uploads/resources/… path)
 * or a link (`type: 'link'`, `content` the URL). `parentId` null is the top
 * ("All files"). `createdAt` / `updatedAt` are the server's local ISO strings,
 * so they sort as text.
 */

/** multer's cap in server.js (uploadResources). The page refuses bigger before sending. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** How many search hits the server returns. */
export const SEARCH_LIMIT = 100;

/** How many files Recent shows. */
export const RECENT_LIMIT = 25;

export type FileKind = 'folder' | 'link' | 'image' | 'pdf' | 'sheet' | 'doc' | 'slides' | 'video' | 'file';

export type TeamItem = {
    _id: string;
    name: string;
    isFolder?: boolean;
    type?: string;
    contentType?: string;
    parentId?: string | null;
    size?: number | null;
    createdAt?: string;
    updatedAt?: string;
};

export type FolderRef = { _id: string; name: string; parentId?: string | null };
export type Crumb = { id: string; name: string };

const EXT_KINDS: [RegExp, FileKind][] = [
    [/\.(jpe?g|png|gif|webp|heic|bmp|svg)$/i, 'image'],
    [/\.pdf$/i, 'pdf'],
    [/\.(xlsx?|xlsm|csv|numbers)$/i, 'sheet'],
    [/\.(docx?|rtf|txt|pages|odt)$/i, 'doc'],
    [/\.(pptx?|key|odp)$/i, 'slides'],
    [/\.(mp4|mov|m4v|webm|avi)$/i, 'video']
];

/** What an item is, for its icon and what the preview can show: the content type first, then the name. */
export function fileKind(item: Pick<TeamItem, 'isFolder' | 'type' | 'contentType' | 'name'>): FileKind {
    if (item.isFolder) return 'folder';
    if (item.type === 'link') return 'link';
    const ct = (item.contentType || '').toLowerCase();
    if (ct.startsWith('image/')) return 'image';
    if (ct === 'application/pdf') return 'pdf';
    if (ct.startsWith('video/')) return 'video';
    if (ct.includes('spreadsheet') || ct.includes('ms-excel') || ct === 'text/csv') return 'sheet';
    if (ct.includes('wordprocessing') || ct === 'application/msword') return 'doc';
    if (ct.includes('presentation') || ct.includes('powerpoint')) return 'slides';
    const name = item.name || '';
    for (const [re, kind] of EXT_KINDS) if (re.test(name)) return kind;
    return 'file';
}

/** The short label in the icon tile ("PDF", "XLSX", "URL"). */
export function kindLabel(item: Pick<TeamItem, 'isFolder' | 'type' | 'contentType' | 'name'>): string {
    const kind = fileKind(item);
    if (kind === 'link') return 'URL';
    if (kind === 'folder') return '';
    const ext = /\.([a-z0-9]{1,5})$/i.exec(item.name || '')?.[1];
    if (ext) return ext.toUpperCase();
    return ({ image: 'IMG', pdf: 'PDF', sheet: 'XLS', doc: 'DOC', slides: 'PPT', video: 'VID', file: 'FILE' } as Record<string, string>)[kind];
}

/** Whether the preview can show it on the page (images and PDFs); the rest open or download. */
export const canPreviewInline = (item: Pick<TeamItem, 'isFolder' | 'type' | 'contentType' | 'name'>): boolean =>
    ['image', 'pdf'].includes(fileKind(item));

/** "880 KB", "2.4 MB"; "—" when it wasn't recorded (files saved before 2026-10-30, links, folders). */
export function formatSize(bytes: number | null | undefined): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
}

/** A dropped file's name, without its extension, as the item's starting name. */
export function nameFromFile(filename: string): string {
    const base = String(filename || '').replace(/^.*[\\/]/, '');
    const trimmed = base.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return trimmed || base.trim() || 'Untitled';
}

/** When it last changed (updatedAt is only on items saved since 2026-10-30). */
export const modifiedOf = (item: Pick<TeamItem, 'createdAt' | 'updatedAt'>): string => item.updatedAt || item.createdAt || '';

/** Folders first, then newest change first ('modified') or A–Z ('name'). Doesn't change the list it's given. */
export function sortItems<T extends TeamItem>(items: T[], by: 'modified' | 'name' = 'modified'): T[] {
    const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    return [...items].sort((a, b) => {
        if (Boolean(a.isFolder) !== Boolean(b.isFolder)) return a.isFolder ? -1 : 1;
        if (by === 'name') return byName(a, b);
        const diff = modifiedOf(b).localeCompare(modifiedOf(a));
        return diff || byName(a, b);
    });
}

const idOf = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** The trail from the top to `folderId`, top first. Null if the folder (or one above it) is gone. */
export function pathTo(folderId: string | null | undefined, folders: FolderRef[]): Crumb[] | null {
    if (!folderId) return [];
    const byId = new Map(folders.map((f) => [String(f._id), f]));
    const trail: Crumb[] = [];
    const seen = new Set<string>();
    let at: string | null = String(folderId);
    while (at) {
        if (seen.has(at)) return null; // a loop in old data: treat as gone
        seen.add(at);
        const folder = byId.get(at);
        if (!folder) return null;
        trail.unshift({ id: String(folder._id), name: folder.name });
        at = idOf(folder.parentId);
    }
    return trail;
}

/** Every folder under `folderId` (not itself), at any depth. */
export function descendantFolderIds(folderId: string, folders: FolderRef[]): Set<string> {
    const children = new Map<string, string[]>();
    for (const f of folders) {
        const parent = idOf(f.parentId);
        if (!parent) continue;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent)!.push(String(f._id));
    }
    const out = new Set<string>();
    const stack = [...(children.get(String(folderId)) || [])];
    while (stack.length) {
        const id = stack.pop()!;
        if (out.has(id)) continue;
        out.add(id);
        stack.push(...(children.get(id) || []));
    }
    return out;
}

/**
 * Whether `item` may move into `targetId` (null = the top). Never into
 * itself, never a folder into one of its own subfolders, and not where it
 * already is (nothing to do). The server checks it again on every move.
 */
export function canMoveInto(item: Pick<TeamItem, '_id' | 'isFolder' | 'parentId'>, targetId: string | null, folders: FolderRef[]): boolean {
    const target = idOf(targetId);
    if (target === idOf(item.parentId)) return false;
    if (target === null) return true;
    if (!folders.some((f) => String(f._id) === target)) return false;
    if (!item.isFolder) return true;
    if (target === String(item._id)) return false;
    return !descendantFolderIds(String(item._id), folders).has(target);
}

export type TreeNode = { id: string; name: string; files: number; totalFiles: number; children: TreeNode[] };

/**
 * Folders as a tree, A–Z at every level. `files` counts a folder's own files;
 * `totalFiles` includes every subfolder's. A folder whose parent is gone sits
 * at the top, so nothing disappears from the tree.
 */
export function buildTree(folders: (FolderRef & { files?: number })[]): TreeNode[] {
    const nodes = new Map<string, TreeNode & { parent: string | null }>();
    for (const f of folders) {
        nodes.set(String(f._id), { id: String(f._id), name: f.name, files: f.files || 0, totalFiles: 0, children: [], parent: idOf(f.parentId) });
    }
    const roots: TreeNode[] = [];
    for (const node of nodes.values()) {
        const parent = node.parent && node.parent !== node.id ? nodes.get(node.parent) : undefined;
        if (parent) parent.children.push(node); else roots.push(node);
    }
    const seen = new Set<string>();
    const finish = (list: TreeNode[]): number => {
        list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
        let sum = 0;
        for (const n of list) {
            if (seen.has(n.id)) { n.children = []; continue; }
            seen.add(n.id);
            n.totalFiles = n.files + finish(n.children);
            sum += n.totalFiles;
        }
        return sum;
    };
    finish(roots);
    const strip = (list: TreeNode[]): TreeNode[] => list.map(({ id, name, files, totalFiles, children }) => ({ id, name, files, totalFiles, children: strip(children) }));
    return strip(roots);
}

export type UploadCheck = { kind: 'file' | 'link'; name: string; fileSize?: number | null; hasFile?: boolean; url?: string; editing?: boolean };

/** Why an upload can't be sent, or null. Same words on the page and from the server. */
export function checkUpload({ kind, name, fileSize, hasFile, url, editing }: UploadCheck): string | null {
    const nameProblem = checkItemName(name);
    if (nameProblem) return nameProblem;
    if (kind === 'link') {
        const value = String(url || '').trim();
        if (!value) return 'Paste the link.';
        if (!isWebLink(value)) return 'The link must start with http:// or https://.';
        return null;
    }
    if (!hasFile && !editing) return 'Choose a file.';
    if (typeof fileSize === 'number' && fileSize > MAX_UPLOAD_BYTES) return 'That file is over 200 MB. Share it as a link instead.';
    return null;
}

/** A file's or link's name (upload and rename); why not, or null. */
export function checkItemName(name: string): string | null {
    const value = String(name ?? '').trim();
    if (!value) return 'Give it a name.';
    if (value.length > 200) return 'Keep the name under 200 characters.';
    return null;
}

/** An http(s) URL with a host (never javascript:, data: or a bare word). */
export function isWebLink(value: string): boolean {
    try {
        const u = new URL(String(value).trim());
        return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
    } catch {
        return false;
    }
}

/** A folder name: trimmed, inner spaces collapsed; why not, or null. */
export function checkFolderName(name: string): string | null {
    const value = String(name || '').replace(/\s+/g, ' ').trim();
    if (!value) return 'Give the folder a name.';
    if (value.length > 120) return 'Keep the name under 120 characters.';
    return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The delete check's sentence, from the server's count of what's inside. */
export function deleteSummary(item: Pick<TeamItem, 'name' | 'isFolder'>, inside: { folders: number; files: number }): string {
    if (!item.isFolder) return `Delete “${item.name}” for everyone? It can't be undone.`;
    const { folders, files } = inside;
    if (folders === 0 && files === 0) return `Delete the empty folder “${item.name}”?`;
    const parts = [folders ? plural(folders, 'folder', 'folders') : '', files ? plural(files, 'file', 'files') : ''].filter(Boolean);
    return `Delete “${item.name}” and the ${parts.join(' and ')} inside it, for everyone? It can't be undone.`;
}

/** A search box's text as a safe, case-insensitive "contains" pattern for MongoDB. */
export function searchPattern(q: string): string | null {
    const value = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!value) return null;
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
