import express from 'express';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import SalesDashboardResource from '../models/SalesDashboardResource.js';
import { canViewTeamFiles, canManageTeamFiles } from '../utils/teamFilesAccess.js';
import {
  canMoveInto, checkFolderName, checkItemName, checkUpload, isWebLink, pathTo, searchPattern, SEARCH_LIMIT, RECENT_LIMIT
} from '../utils/teamFiles.ts';
import { displayNameOf } from '../utils/salesReps.js';

/**
 * Team Files (2026-10-30): the Sales page's shared folders, files and links.
 * Design and plan: the claude.ai artifact **Team Files Page Canvas**
 * (https://claude.ai/artifact/NRBYg5zf4Ycw8NCuMrpd97). Records are
 * SalesDashboardResource; the rules are src/utils/teamFiles.ts.
 *
 *   GET    /api/team-files?folder=<id>        View   the folder, its trail, its items (no content)
 *   GET    /api/team-files/tree               View   every folder with its own file count
 *   GET    /api/team-files/search?q=          View   files by name in every folder, with their trail
 *   GET    /api/team-files/pinned             View   pinned files, newest pin first
 *   GET    /api/team-files/recent             View   the most recently changed files
 *   GET    /api/team-files/:id                View   one item with its content
 *   POST   /api/team-files                    Manage upload a file (multipart `file`) or a link (`url`)
 *   POST   /api/team-files/folders            Manage { name, parentId }
 *   PATCH  /api/team-files/:id                Manage { name?, parentId?, pinned? }: rename, move, pin
 *   PUT    /api/team-files/:id                Manage replace the file (multipart) or the link (`url`)
 *   GET    /api/team-files/:id/delete-summary Manage { folders, files } a delete would take
 *   DELETE /api/team-files/:id                Manage the item, and for a folder everything inside it
 *
 * The old /api/sales-dashboard/* routes answer through createLegacyTeamFilesRouter
 * below, with their old shapes, until cached apps update (KNOWN_ISSUES.md,
 * Cleanup due). Every write emits `resource_update` so open pages refresh.
 *
 *   app.use('/api/team-files', createTeamFilesRouter(deps));
 *   app.use('/api/sales-dashboard', createLegacyTeamFilesRouter(deps));
 *
 * deps: { authenticate, upload (multer middleware for one `file`),
 *         uploadToCloudinary(buffer, folder, name), publicDir, getNowLocalISO }
 */

const isId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && /^[a-f0-9]{24}$/i.test(v);
const POPULATE = [
  { path: 'uploadedBy', select: 'username displayName' },
  { path: 'updatedBy', select: 'username displayName' }
];

/** A record as the page reads it: names for who added / changed it, ids as strings. */
const shape = (doc) => {
  const r = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  r._id = String(r._id);
  r.parentId = r.parentId ? String(r.parentId) : null;
  r.uploadedByName = r.uploadedBy && typeof r.uploadedBy === 'object' ? displayNameOf(r.uploadedBy) : '';
  r.updatedByName = r.updatedBy && typeof r.updatedBy === 'object' ? displayNameOf(r.updatedBy) : '';
  return r;
};

/** Every folder, slim (the tree, trails and move checks). */
const allFolders = async () => (await SalesDashboardResource.find({ isFolder: true }).select('name parentId').lean())
  .map((f) => ({ _id: String(f._id), name: f.name, parentId: f.parentId ? String(f.parentId) : null }));

/** How many files (not folders) sit directly in each of `parentIds` (null = the top). */
const fileCounts = async (parentIds) => {
  const match = { isFolder: { $ne: true } };
  if (parentIds) match.parentId = { $in: parentIds.map((id) => new mongoose.Types.ObjectId(id)) };
  const rows = await SalesDashboardResource.aggregate([{ $match: match }, { $group: { _id: '$parentId', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id ? String(r._id) : null, r.n]));
};

/** Everything under a folder: its folders' ids and its files (for the summary, and to remove disk files). */
const subtreeOf = async (folderId) => {
  const folders = [];
  const files = [];
  let frontier = [new mongoose.Types.ObjectId(folderId)];
  const seen = new Set([String(folderId)]);
  while (frontier.length) {
    const children = await SalesDashboardResource.find({ parentId: { $in: frontier } }).select('isFolder content').lean();
    frontier = [];
    for (const c of children) {
      if (c.isFolder) {
        if (seen.has(String(c._id))) continue;
        seen.add(String(c._id));
        folders.push(c._id);
        frontier.push(c._id);
      } else {
        files.push(c);
      }
    }
  }
  return { folders, files };
};

export function createTeamFilesCore({ uploadToCloudinary, publicDir, getNowLocalISO }) {
  const uploadDir = path.join(publicDir, 'uploads', 'resources');

  /** A file from multer as stored content: images to Cloudinary, the rest to disk. */
  const storeFile = async (file) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    if (file.mimetype?.startsWith('image/')) {
      const result = await uploadToCloudinary(file.buffer, 'Resources', `res_${suffix}`);
      return { content: result.secure_url, contentType: 'image/webp', size: file.size ?? file.buffer?.length };
    }
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'file', ext).replace(/[^a-zA-Z0-9]/g, '_') || 'file';
    const filename = `${base}_${suffix}${ext.replace(/[^.a-zA-Z0-9]/g, '')}`;
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
    return { content: `/uploads/resources/${filename}`, contentType: file.mimetype || 'application/octet-stream', size: file.size ?? file.buffer?.length };
  };

  /** Remove a disk file we stored; never anything outside uploads/resources. */
  const removeStored = async (content) => {
    if (typeof content !== 'string' || !content.startsWith('/uploads/resources/')) return;
    const target = path.resolve(publicDir, `.${content}`);
    if (!target.startsWith(path.resolve(uploadDir) + path.sep)) return;
    try { await fs.promises.unlink(target); } catch { /* already gone — not fatal */ }
  };

  /** Delete an item, and for a folder everything under it; disk files after the records. */
  const deleteItem = async (item) => {
    const { folders, files } = item.isFolder ? await subtreeOf(String(item._id)) : { folders: [], files: [] };
    const ids = [item._id, ...folders, ...files.map((f) => f._id)];
    await SalesDashboardResource.deleteMany({ _id: { $in: ids } });
    await Promise.all([item, ...files].map((f) => removeStored(f.content)));
    return { folders: folders.length, files: files.length };
  };

  /** null (the top) or an existing folder's id; `false` when it names something else. */
  const parentFrom = async (value) => {
    if (value === undefined || value === null || value === '' || value === 'null' || value === 'root') return null;
    if (!isId(String(value))) return false;
    const folder = await SalesDashboardResource.findOne({ _id: value, isFolder: true }).select('_id').lean();
    return folder ? String(folder._id) : false;
  };

  const thumbnailFrom = (value) => (
    typeof value === 'string' && value.startsWith('data:image/') && value.length < 300_000 ? value : ''
  );

  const emit = (req) => req.app.get('io')?.emit?.('resource_update');

  return { storeFile, removeStored, deleteItem, parentFrom, thumbnailFrom, emit, now: getNowLocalISO };
}

const requireView = (req, res, next) => (
  canViewTeamFiles(req.user) ? next() : res.status(403).json({ message: 'Your role can’t open Team Files.' })
);
const requireManage = (req, res, next) => (
  canManageTeamFiles(req.user) ? next() : res.status(403).json({ message: 'Your role can’t change Team Files.' })
);
const userIdOf = (req) => (isId(String(req.userId || req.user?._id || req.user?.id || '')) ? String(req.userId || req.user?._id || req.user?.id) : undefined);

export default function createTeamFilesRouter(deps) {
  const { authenticate, upload } = deps;
  const core = createTeamFilesCore(deps);
  const router = express.Router();
  const view = [authenticate, requireView];
  const manage = [authenticate, requireManage];

  const findItem = async (req, res) => {
    if (!isId(req.params.id)) { res.status(404).json({ message: 'That file or folder no longer exists.' }); return null; }
    const item = await SalesDashboardResource.findById(req.params.id);
    if (!item) { res.status(404).json({ message: 'That file or folder no longer exists.' }); return null; }
    return item;
  };

  router.get('/', ...view, async (req, res) => {
    try {
      const folderId = req.query.folder && req.query.folder !== 'root' ? String(req.query.folder) : null;
      const folders = await allFolders();
      const trail = pathTo(folderId, folders);
      if (folderId && !trail) return res.status(404).json({ message: 'That folder was deleted or moved.', folderGone: true });
      const items = await SalesDashboardResource.find({ parentId: folderId ? new mongoose.Types.ObjectId(folderId) : null })
        .select('-content').populate(POPULATE).sort({ isFolder: -1, createdAt: -1 });
      const subIds = items.filter((i) => i.isFolder).map((i) => String(i._id));
      const counts = subIds.length ? await fileCounts(subIds) : new Map();
      res.json({
        folder: folderId ? { _id: folderId, name: trail.at(-1).name } : null,
        path: trail,
        items: items.map((i) => ({ ...shape(i), ...(i.isFolder ? { files: counts.get(String(i._id)) || 0 } : {}) }))
      });
    } catch (error) {
      console.error('Team Files list failed:', error);
      res.status(500).json({ message: 'Couldn’t load Team Files. Try again.' });
    }
  });

  router.get('/tree', ...view, async (req, res) => {
    try {
      const folders = await allFolders();
      const counts = await fileCounts(null);
      res.json({
        folders: folders.map((f) => ({ ...f, files: counts.get(f._id) || 0 })),
        topFiles: counts.get(null) || 0
      });
    } catch (error) {
      console.error('Team Files tree failed:', error);
      res.status(500).json({ message: 'Couldn’t load the folders. Try again.' });
    }
  });

  router.get('/search', ...view, async (req, res) => {
    const pattern = searchPattern(String(req.query.q || ''));
    if (!pattern) return res.json({ items: [], total: 0 });
    try {
      const query = { isFolder: { $ne: true }, name: { $regex: pattern, $options: 'i' } };
      const [hits, total, folders] = await Promise.all([
        SalesDashboardResource.find(query).select('-content').populate(POPULATE).sort({ createdAt: -1 }).limit(SEARCH_LIMIT),
        SalesDashboardResource.countDocuments(query),
        allFolders()
      ]);
      res.json({
        total,
        items: hits.map((h) => {
          const r = shape(h);
          return { ...r, path: pathTo(r.parentId, folders) || [] };
        })
      });
    } catch (error) {
      console.error('Team Files search failed:', error);
      res.status(500).json({ message: 'Search failed. Try again.' });
    }
  });

  const listOf = (query, sort, limit) => async (req, res) => {
    try {
      const [items, folders] = await Promise.all([
        SalesDashboardResource.find(query).select('-content').populate(POPULATE).sort(sort).limit(limit),
        allFolders()
      ]);
      res.json({ items: items.map((i) => { const r = shape(i); return { ...r, path: pathTo(r.parentId, folders) || [] }; }) });
    } catch (error) {
      console.error('Team Files list failed:', error);
      res.status(500).json({ message: 'Couldn’t load Team Files. Try again.' });
    }
  };
  router.get('/pinned', ...view, listOf({ pinned: true, isFolder: { $ne: true } }, { pinnedAt: -1 }, 200));
  // updatedAt only exists on records changed since 2026-10-30; createdAt orders the rest.
  router.get('/recent', ...view, listOf({ isFolder: { $ne: true } }, { updatedAt: -1, createdAt: -1 }, RECENT_LIMIT));

  router.get('/:id', ...view, async (req, res) => {
    try {
      const item = await findItem(req, res);
      if (!item) return;
      await item.populate(POPULATE);
      res.json(shape(item));
    } catch (error) {
      console.error('Team Files read failed:', error);
      res.status(500).json({ message: 'Couldn’t open that file. Try again.' });
    }
  });

  router.post('/', ...manage, upload, async (req, res) => {
    try {
      const kind = req.body.kind === 'link' || req.body.type === 'link' ? 'link' : 'file';
      const problem = checkUpload({ kind, name: req.body.name, hasFile: Boolean(req.file), fileSize: req.file?.size, url: req.body.url ?? req.body.content });
      if (problem) return res.status(400).json({ message: problem });
      const parentId = await core.parentFrom(req.body.parentId);
      if (parentId === false) return res.status(400).json({ message: 'That folder no longer exists.', folderGone: true });
      const stored = kind === 'link'
        ? { content: String(req.body.url ?? req.body.content).trim(), contentType: 'text/uri-list' }
        : await core.storeFile(req.file);
      const item = await SalesDashboardResource.create({
        name: String(req.body.name).trim(),
        type: kind,
        ...stored,
        isFolder: false,
        parentId,
        thumbnail: core.thumbnailFrom(req.body.thumbnail),
        uploadedBy: userIdOf(req),
        createdAt: core.now()
      });
      await item.populate(POPULATE);
      core.emit(req);
      res.status(201).json(shape(item));
    } catch (error) {
      console.error('Team Files upload failed:', error);
      res.status(500).json({ message: 'The upload didn’t save. Try again.' });
    }
  });

  router.post('/folders', ...manage, async (req, res) => {
    try {
      const problem = checkFolderName(req.body?.name);
      if (problem) return res.status(400).json({ message: problem });
      const parentId = await core.parentFrom(req.body?.parentId);
      if (parentId === false) return res.status(400).json({ message: 'That folder no longer exists.', folderGone: true });
      const folder = await SalesDashboardResource.create({
        name: String(req.body.name).replace(/\s+/g, ' ').trim(),
        type: 'folder',
        content: '',
        contentType: 'application/vnd.google-apps.folder',
        isFolder: true,
        parentId,
        uploadedBy: userIdOf(req),
        createdAt: core.now()
      });
      await folder.populate(POPULATE);
      core.emit(req);
      res.status(201).json({ ...shape(folder), files: 0 });
    } catch (error) {
      console.error('Team Files new folder failed:', error);
      res.status(500).json({ message: 'The folder didn’t save. Try again.' });
    }
  });

  router.patch('/:id', ...manage, async (req, res) => {
    try {
      const item = await findItem(req, res);
      if (!item) return;
      const body = req.body || {};
      if (body.name !== undefined) {
        const problem = item.isFolder ? checkFolderName(body.name) : checkItemName(body.name);
        if (problem) return res.status(400).json({ message: problem });
        item.name = String(body.name).replace(/\s+/g, ' ').trim();
      }
      if (body.parentId !== undefined) {
        const target = body.parentId === null || body.parentId === '' || body.parentId === 'root' ? null : String(body.parentId);
        if (target !== (item.parentId ? String(item.parentId) : null)) {
          const folders = await allFolders();
          const it = { _id: String(item._id), isFolder: item.isFolder, parentId: item.parentId ? String(item.parentId) : null };
          if (!canMoveInto(it, target, folders)) {
            const why = target && !folders.some((f) => f._id === target)
              ? 'That folder no longer exists.'
              : 'A folder can’t go inside itself or one of its own folders.';
            return res.status(400).json({ message: why });
          }
          item.parentId = target;
        }
      }
      if (body.pinned !== undefined) {
        if (item.isFolder) return res.status(400).json({ message: 'Only files and links can be pinned.' });
        const pinned = body.pinned === true || body.pinned === 'true';
        if (pinned !== Boolean(item.pinned)) {
          item.pinned = pinned;
          item.pinnedAt = pinned ? core.now() : undefined;
          item.pinnedBy = pinned ? userIdOf(req) : undefined;
        }
      }
      if (item.isModified()) {
        // A pin isn't a change to the file: Modified and Recent stay as they were.
        if (item.isModified('name') || item.isModified('parentId')) {
          item.updatedAt = core.now();
          item.updatedBy = userIdOf(req);
        }
        await item.save();
        core.emit(req);
      }
      await item.populate(POPULATE);
      const r = shape(item);
      res.json(r);
    } catch (error) {
      console.error('Team Files change failed:', error);
      res.status(500).json({ message: 'The change didn’t save. Try again.' });
    }
  });

  router.put('/:id', ...manage, upload, async (req, res) => {
    try {
      const item = await findItem(req, res);
      if (!item) return;
      if (item.isFolder) return res.status(400).json({ message: 'A folder has no file to replace. Rename it instead.' });
      const old = item.content;
      if (item.type === 'link') {
        const url = String(req.body.url ?? req.body.content ?? '').trim();
        if (!isWebLink(url)) return res.status(400).json({ message: 'The link must start with http:// or https://.' });
        item.content = url;
      } else {
        const problem = checkUpload({ kind: 'file', name: req.body.name || item.name, hasFile: Boolean(req.file), fileSize: req.file?.size });
        if (problem) return res.status(400).json({ message: problem });
        Object.assign(item, await core.storeFile(req.file));
        const thumb = core.thumbnailFrom(req.body.thumbnail);
        item.thumbnail = thumb;
      }
      if (req.body.name !== undefined && String(req.body.name).trim()) item.name = String(req.body.name).replace(/\s+/g, ' ').trim();
      item.updatedAt = core.now();
      item.updatedBy = userIdOf(req);
      await item.save();
      if (item.content !== old) await core.removeStored(old);
      await item.populate(POPULATE);
      core.emit(req);
      res.json(shape(item));
    } catch (error) {
      console.error('Team Files replace failed:', error);
      res.status(500).json({ message: 'The new file didn’t save. Try again.' });
    }
  });

  router.get('/:id/delete-summary', ...manage, async (req, res) => {
    try {
      const item = await findItem(req, res);
      if (!item) return;
      if (!item.isFolder) return res.json({ folders: 0, files: 0 });
      const { folders, files } = await subtreeOf(String(item._id));
      res.json({ folders: folders.length, files: files.length });
    } catch (error) {
      console.error('Team Files delete summary failed:', error);
      res.status(500).json({ message: 'Couldn’t count what’s inside. Try again.' });
    }
  });

  router.delete('/:id', ...manage, async (req, res) => {
    try {
      const item = await findItem(req, res);
      if (!item) return;
      const removed = await core.deleteItem(item);
      core.emit(req);
      res.json({ deleted: true, ...removed });
    } catch (error) {
      console.error('Team Files delete failed:', error);
      res.status(500).json({ message: 'The delete didn’t go through. Try again.' });
    }
  });

  return router;
}

/**
 * The old Dashboard routes, kept with their old request and answer shapes for
 * apps still running the cached screen: /resources?parentId= (an array),
 * /resources/:id, /upload (file, link or folder), PUT and DELETE /resources/:id.
 * Same switches as the new routes. Remove with KNOWN_ISSUES.md's Cleanup due.
 */
export function createLegacyTeamFilesRouter(deps) {
  const { authenticate, upload } = deps;
  const core = createTeamFilesCore(deps);
  const router = express.Router();
  const view = [authenticate, requireView];
  const manage = [authenticate, requireManage];
  const legacyPopulate = { path: 'uploadedBy', select: 'username' };

  router.get('/resources', ...view, async (req, res) => {
    try {
      const { parentId } = req.query;
      if (parentId && !isId(String(parentId))) return res.json([]);
      const items = await SalesDashboardResource.find({ parentId: parentId || null })
        .select('-content').populate(legacyPopulate).sort({ isFolder: -1, createdAt: -1 });
      res.json(items);
    } catch (error) {
      console.error('Error fetching dashboard resources:', error);
      res.status(500).json({ message: 'Failed to fetch dashboard resources' });
    }
  });

  router.get('/resources/:id', ...view, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(404).json({ message: 'Resource not found' });
      const item = await SalesDashboardResource.findById(req.params.id).populate(legacyPopulate);
      if (!item) return res.status(404).json({ message: 'Resource not found' });
      res.json(item);
    } catch {
      res.status(500).json({ message: 'Failed to fetch resource' });
    }
  });

  router.post('/upload', ...manage, upload, async (req, res) => {
    try {
      const { name, type, content: linkContent, isFolder, thumbnail } = req.body;
      const folder = isFolder === 'true' || isFolder === true;
      const parentId = await core.parentFrom(req.body.parentId);
      if (parentId === false) return res.status(400).json({ message: 'That folder no longer exists.' });
      let stored;
      if (folder) {
        const problem = checkFolderName(name);
        if (problem) return res.status(400).json({ message: problem });
        stored = { content: '', contentType: 'application/vnd.google-apps.folder' };
      } else if (req.file) {
        stored = await core.storeFile(req.file);
      } else if (type === 'link' && isWebLink(String(linkContent || ''))) {
        stored = { content: String(linkContent).trim(), contentType: 'text/uri-list' };
      } else {
        return res.status(400).json({ message: 'Invalid resource data' });
      }
      if (!String(name || '').trim()) return res.status(400).json({ message: 'Give it a name.' });
      const item = await SalesDashboardResource.create({
        name: String(name).trim(),
        type: folder ? 'folder' : (type === 'link' ? 'link' : 'file'),
        ...stored,
        isFolder: folder,
        parentId,
        thumbnail: core.thumbnailFrom(thumbnail),
        uploadedBy: userIdOf(req),
        createdAt: core.now()
      });
      await item.populate(legacyPopulate);
      core.emit(req);
      res.status(201).json(item);
    } catch (error) {
      console.error('Error uploading dashboard resource:', error);
      res.status(500).json({ message: 'Failed to upload resource' });
    }
  });

  router.put('/resources/:id', ...manage, upload, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(404).json({ message: 'Resource not found' });
      const item = await SalesDashboardResource.findById(req.params.id);
      if (!item) return res.status(404).json({ message: 'Resource not found' });
      const { name, type, content: linkContent, thumbnail } = req.body;
      const old = item.content;
      if (name && String(name).trim()) item.name = String(name).trim();
      if (req.file) {
        Object.assign(item, await core.storeFile(req.file));
      } else if (type === 'link' && linkContent) {
        if (!isWebLink(String(linkContent))) return res.status(400).json({ message: 'The link must start with http:// or https://.' });
        item.content = String(linkContent).trim();
        item.contentType = 'text/uri-list';
      }
      const thumb = core.thumbnailFrom(thumbnail);
      if (thumb) item.thumbnail = thumb;
      item.updatedAt = core.now();
      item.updatedBy = userIdOf(req);
      await item.save();
      if (item.content !== old) await core.removeStored(old);
      core.emit(req);
      res.json(item);
    } catch (error) {
      console.error('Error updating dashboard resource:', error);
      res.status(500).json({ message: 'Failed to update resource' });
    }
  });

  router.delete('/resources/:id', ...manage, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(404).json({ message: 'Resource not found' });
      const item = await SalesDashboardResource.findById(req.params.id);
      if (!item) return res.status(404).json({ message: 'Resource not found' });
      await core.deleteItem(item);
      core.emit(req);
      res.json({ message: 'Resource deleted successfully' });
    } catch (error) {
      console.error('Error deleting resource:', error);
      res.status(500).json({ message: 'Failed to delete resource' });
    }
  });

  return router;
}
