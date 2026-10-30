import { describe, it, expect } from 'vitest';
import {
    fileKind, kindLabel, canPreviewInline, formatSize, nameFromFile, sortItems, pathTo, descendantFolderIds,
    canMoveInto, buildTree, checkUpload, isWebLink, checkFolderName, deleteSummary, searchPattern, MAX_UPLOAD_BYTES
} from './teamFiles.ts';

// All files › Price lists › 2026, All files › Price lists › Archive 2025, All files › Forms
const FOLDERS = [
    { _id: 'price', name: 'Price lists', parentId: null },
    { _id: 'y26', name: '2026', parentId: 'price' },
    { _id: 'arc', name: 'Archive 2025', parentId: 'price' },
    { _id: 'deep', name: 'Q1', parentId: 'arc' },
    { _id: 'forms', name: 'Forms', parentId: null }
];

describe('fileKind and its label', () => {
    it('reads the content type first', () => {
        expect(fileKind({ name: 'Card', contentType: 'image/webp' })).toBe('image');
        expect(fileKind({ name: 'List', contentType: 'application/pdf' })).toBe('pdf');
        expect(fileKind({ name: 'x', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe('sheet');
        expect(fileKind({ name: 'x', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('doc');
        expect(fileKind({ name: 'x', contentType: 'video/mp4' })).toBe('video');
    });

    it('falls back to the name, and knows folders and links', () => {
        expect(fileKind({ name: 'Remnants.PDF', contentType: 'application/octet-stream' })).toBe('pdf');
        expect(fileKind({ name: 'Net.xlsx' })).toBe('sheet');
        expect(fileKind({ name: 'Mystery' })).toBe('file');
        expect(fileKind({ name: 'Price lists', isFolder: true })).toBe('folder');
        expect(fileKind({ name: 'Price book', type: 'link', contentType: 'text/uri-list' })).toBe('link');
    });

    it('labels by extension, else by kind', () => {
        expect(kindLabel({ name: 'Net.xlsx' })).toBe('XLSX');
        expect(kindLabel({ name: 'Moda card', contentType: 'image/webp' })).toBe('IMG');
        expect(kindLabel({ name: 'Price book', type: 'link' })).toBe('URL');
    });

    it('previews images and PDFs on the page, nothing else', () => {
        expect(canPreviewInline({ name: 'a.jpg' })).toBe(true);
        expect(canPreviewInline({ name: 'a.pdf' })).toBe(true);
        expect(canPreviewInline({ name: 'a.xlsx' })).toBe(false);
        expect(canPreviewInline({ name: 'Price book', type: 'link' })).toBe(false);
    });
});

describe('formatSize and nameFromFile', () => {
    it('shows sizes people read, and a dash when it was never recorded', () => {
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(900 * 1024)).toBe('900 KB');
        expect(formatSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
        expect(formatSize(150 * 1024 * 1024)).toBe('150 MB');
        expect(formatSize(undefined)).toBe('—');
        expect(formatSize(null)).toBe('—');
        expect(formatSize(-1)).toBe('—');
    });

    it('names a dropped file after itself, without the extension', () => {
        expect(nameFromFile('Fabricator_price_list NW.pdf')).toBe('Fabricator price list NW');
        expect(nameFromFile('C:\\fakepath\\Spec.sheet.docx')).toBe('Spec.sheet');
        expect(nameFromFile('.pdf')).toBe('.pdf');
        expect(nameFromFile('')).toBe('Untitled');
    });
});

describe('sortItems', () => {
    const items = [
        { _id: '1', name: 'b file', createdAt: '2026-10-01T09:00:00.000' },
        { _id: '2', name: 'Z folder', isFolder: true, createdAt: '2026-01-01T09:00:00.000' },
        { _id: '3', name: 'a file', createdAt: '2026-09-01T09:00:00.000', updatedAt: '2026-10-29T09:00:00.000' },
        { _id: '4', name: 'A folder', isFolder: true, createdAt: '2026-02-01T09:00:00.000' }
    ];

    it('puts folders first, then the newest change (an edit counts)', () => {
        expect(sortItems(items).map((i) => i._id)).toEqual(['4', '2', '3', '1']);
    });

    it('sorts A–Z on request, and leaves the list it was given alone', () => {
        expect(sortItems(items, 'name').map((i) => i._id)).toEqual(['4', '2', '3', '1']);
        expect(items.map((i) => i._id)).toEqual(['1', '2', '3', '4']);
    });
});

describe('folder trail, subfolders and moves', () => {
    it('builds the trail from the top', () => {
        expect(pathTo('deep', FOLDERS)).toEqual([
            { id: 'price', name: 'Price lists' }, { id: 'arc', name: 'Archive 2025' }, { id: 'deep', name: 'Q1' }
        ]);
        expect(pathTo(null, FOLDERS)).toEqual([]);
    });

    it('says null for a folder that is gone, or a loop in old data', () => {
        expect(pathTo('nope', FOLDERS)).toBeNull();
        expect(pathTo('a', [{ _id: 'a', name: 'A', parentId: 'b' }, { _id: 'b', name: 'B', parentId: 'a' }])).toBeNull();
    });

    it('finds every subfolder at any depth', () => {
        expect([...descendantFolderIds('price', FOLDERS)].sort()).toEqual(['arc', 'deep', 'y26']);
        expect(descendantFolderIds('forms', FOLDERS).size).toBe(0);
    });

    it('never moves a folder into itself or its own subfolders', () => {
        const arc = { _id: 'arc', isFolder: true, parentId: 'price' };
        expect(canMoveInto(arc, 'arc', FOLDERS)).toBe(false);
        expect(canMoveInto(arc, 'deep', FOLDERS)).toBe(false);
        expect(canMoveInto(arc, 'forms', FOLDERS)).toBe(true);
        expect(canMoveInto(arc, null, FOLDERS)).toBe(true);
        expect(canMoveInto({ _id: 'price', isFolder: true, parentId: null }, 'deep', FOLDERS)).toBe(false);
    });

    it('refuses a move to where it already is, or to a folder that is gone', () => {
        expect(canMoveInto({ _id: 'f1', parentId: 'forms' }, 'forms', FOLDERS)).toBe(false);
        expect(canMoveInto({ _id: 'f1', parentId: null }, null, FOLDERS)).toBe(false);
        expect(canMoveInto({ _id: 'f1', parentId: null }, 'nope', FOLDERS)).toBe(false);
        expect(canMoveInto({ _id: 'f1', parentId: null }, 'deep', FOLDERS)).toBe(true);
    });
});

describe('buildTree', () => {
    it('nests A–Z with counts that include subfolders', () => {
        const tree = buildTree(FOLDERS.map((f) => ({ ...f, files: { price: 2, y26: 6, arc: 3, deep: 1, forms: 5 }[f._id] })));
        expect(tree.map((n) => n.name)).toEqual(['Forms', 'Price lists']);
        const price = tree[1];
        expect(price).toMatchObject({ files: 2, totalFiles: 12 });
        expect(price.children.map((n) => n.name)).toEqual(['2026', 'Archive 2025']);
        expect(price.children[1]).toMatchObject({ totalFiles: 4, children: [{ name: 'Q1', totalFiles: 1 }] });
    });

    it('keeps a folder whose parent is gone at the top', () => {
        expect(buildTree([{ _id: 'x', name: 'Orphan', parentId: 'gone' }]).map((n) => n.name)).toEqual(['Orphan']);
    });
});

describe('checkUpload, links and folder names', () => {
    it('needs a name and a file, or a web link', () => {
        expect(checkUpload({ kind: 'file', name: ' ', hasFile: true })).toBe('Give it a name.');
        expect(checkUpload({ kind: 'file', name: 'Spec', hasFile: false })).toBe('Choose a file.');
        expect(checkUpload({ kind: 'file', name: 'Spec', hasFile: false, editing: true })).toBeNull();
        expect(checkUpload({ kind: 'file', name: 'Spec', hasFile: true, fileSize: 1000 })).toBeNull();
        expect(checkUpload({ kind: 'link', name: 'Book', url: '' })).toBe('Paste the link.');
        expect(checkUpload({ kind: 'link', name: 'Book', url: 'https://stoneprofits.com/x' })).toBeNull();
    });

    it('refuses a file over 200 MB before it is sent', () => {
        expect(checkUpload({ kind: 'file', name: 'Video', hasFile: true, fileSize: MAX_UPLOAD_BYTES + 1 })).toMatch(/over 200 MB/);
        expect(checkUpload({ kind: 'file', name: 'Video', hasFile: true, fileSize: MAX_UPLOAD_BYTES })).toBeNull();
    });

    it('takes only http(s) links', () => {
        expect(isWebLink('https://example.com')).toBe(true);
        expect(isWebLink('http://example.com/a?b=c')).toBe(true);
        expect(isWebLink('javascript:alert(1)')).toBe(false);
        expect(isWebLink('data:text/html,hi')).toBe(false);
        expect(isWebLink('example.com')).toBe(false);
    });

    it('needs a folder name', () => {
        expect(checkFolderName('  ')).toBe('Give the folder a name.');
        expect(checkFolderName('Forms')).toBeNull();
        expect(checkFolderName('x'.repeat(121))).toMatch(/120/);
    });
});

describe('deleteSummary and searchPattern', () => {
    it('says what a delete takes with it', () => {
        expect(deleteSummary({ name: 'Moda Quartz', isFolder: true }, { folders: 2, files: 18 }))
            .toBe('Delete “Moda Quartz” and the 2 folders and 18 files inside it, for everyone? It can\'t be undone.');
        expect(deleteSummary({ name: 'Care', isFolder: true }, { folders: 0, files: 1 }))
            .toBe('Delete “Care” and the 1 file inside it, for everyone? It can\'t be undone.');
        expect(deleteSummary({ name: 'Empty', isFolder: true }, { folders: 0, files: 0 })).toBe('Delete the empty folder “Empty”?');
        expect(deleteSummary({ name: 'Net.xlsx' }, { folders: 0, files: 0 })).toBe('Delete “Net.xlsx” for everyone? It can\'t be undone.');
    });

    it('escapes what was typed so it matches literally', () => {
        expect(searchPattern('  moda   quartz ')).toBe('moda quartz');
        expect(searchPattern('Q4 (draft).pdf')).toBe('Q4 \\(draft\\)\\.pdf');
        expect(searchPattern('   ')).toBeNull();
        expect(new RegExp(searchPattern('a+b')!, 'i').test('A+B list')).toBe(true);
    });
});
