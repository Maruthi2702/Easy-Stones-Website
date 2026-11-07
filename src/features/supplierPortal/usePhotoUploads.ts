import { useCallback, useEffect, useRef, useState } from 'react';
import { compressImage } from '../../utils/attachmentFiles';
import { uploadPhoto, type PortalError } from './portalApi';
import type { PortalBlock } from './types';

export type UploadState = { preview: string; state: 'uploading' | 'waiting' | 'failed'; code?: string };

const RETRY_MS = 12_000;

/**
 * The block screen's photos: each one is shrunk on the phone (1800px, JPEG)
 * and uploads the moment it's taken, its picture showing at once. With no
 * signal it waits and sends itself when the phone is back online (and every
 * few seconds meanwhile); a refusal (the bundle was locked meanwhile) stops
 * and says why. Leaving the page while one is still going asks first.
 */
export function usePhotoUploads(blockId: string, onSaved: (b: PortalBlock) => void) {
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const queue = useRef(new Map<string, string>());
  const running = useRef(new Set<string>());
  const saved = useRef(onSaved);
  saved.current = onSaved;

  const patch = (bundleId: string, next: UploadState | null) => setUploads((all) => {
    const copy = { ...all };
    if (next) copy[bundleId] = next; else delete copy[bundleId];
    return copy;
  });

  const run = useCallback(async (bundleId: string) => {
    const data = queue.current.get(bundleId);
    if (!data || running.current.has(bundleId)) return;
    running.current.add(bundleId);
    patch(bundleId, { preview: data, state: 'uploading' });
    try {
      const { block } = await uploadPhoto(blockId, bundleId, data);
      // A newer photo for the same bundle may have been taken meanwhile.
      if (queue.current.get(bundleId) === data) { queue.current.delete(bundleId); patch(bundleId, null); }
      saved.current(block);
    } catch (e) {
      const err = e as PortalError;
      const offline = err.status === 0 || err.status >= 500;
      if (!offline) queue.current.delete(bundleId);
      patch(bundleId, { preview: data, state: offline ? 'waiting' : 'failed', code: err.code });
    } finally {
      running.current.delete(bundleId);
      if (queue.current.has(bundleId) && queue.current.get(bundleId) !== data) run(bundleId);
    }
  }, [blockId]);

  const retryAll = useCallback(() => { for (const id of queue.current.keys()) run(id); }, [run]);

  useEffect(() => {
    window.addEventListener('online', retryAll);
    const timer = window.setInterval(() => { if (queue.current.size) retryAll(); }, RETRY_MS);
    return () => { window.removeEventListener('online', retryAll); window.clearInterval(timer); };
  }, [retryAll]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  /** A photo picked for a bundle. */
  const take = useCallback(async (bundleId: string, file: File) => {
    let data: string;
    try {
      data = await compressImage(file, 1800, 0.82);
    } catch {
      patch(bundleId, { preview: '', state: 'failed', code: 'needPhoto' });
      return;
    }
    queue.current.set(bundleId, data);
    run(bundleId);
  }, [run]);

  return { uploads, take, retry: run, pending: Object.values(uploads).filter((u) => u.state !== 'failed').length };
}
