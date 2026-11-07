import { useCallback, useEffect, useRef, useState } from 'react';
import { can, SUPPLIER_POS } from '../../utils/supplierAccess';
import * as api from './suppliersApi';
import type { Block, Meta, Po, SupplierRow, SuppliersUser } from './types';

/**
 * Supplier POs' data: the lists the forms need (meta), the POs (open ones, or
 * every one when the Status filter asks), both approval queues, and the
 * suppliers. Everything reloads when the tab comes back into view, so a
 * block a supplier sent meanwhile shows up without a refresh.
 */
export function useSupplierPos(user: SuppliersUser | null) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pos, setPos] = useState<Po[]>([]);
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [review, setReview] = useState<Block[]>([]);
  const [final, setFinal] = useState<Block[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const asked = useRef('');

  const mayReview = can(user, SUPPLIER_POS.REVIEW) || can(user, SUPPLIER_POS.VIEW);
  const mayFinal = can(user, SUPPLIER_POS.FINAL) || can(user, SUPPLIER_POS.VIEW);

  useEffect(() => {
    let live = true;
    api.loadMeta().then((m) => { if (live) setMeta(m); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const loadPos = useCallback(async () => {
    const key = scope;
    asked.current = key;
    setLoading(true);
    try {
      const res = await api.listPos(scope);
      if (asked.current === key) { setPos(res.pos); setError(''); }
    } catch (e) {
      if (asked.current === key) setError((e as Error).message);
    } finally {
      if (asked.current === key) setLoading(false);
    }
  }, [scope]);

  const loadQueues = useCallback(async () => {
    const [r, f] = await Promise.all([
      mayReview ? api.listBlocks('review').catch(() => null) : null,
      mayFinal ? api.listBlocks('final').catch(() => null) : null
    ]);
    if (r) setReview(r.blocks);
    if (f) setFinal(f.blocks);
  }, [mayReview, mayFinal]);

  const loadSuppliers = useCallback(async () => {
    try { setSuppliers((await api.listSuppliers()).suppliers); } catch { /* the POs list shows any error */ }
  }, []);

  useEffect(() => { loadPos(); }, [loadPos]);
  useEffect(() => { loadQueues(); loadSuppliers(); }, [loadQueues, loadSuppliers]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') { loadPos(); loadQueues(); } };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [loadPos, loadQueues]);

  /** A PO saved or changed: in place in the list (its blocks' stages come with it). */
  const placePo = (po: Po) => setPos((list) => [po, ...list.filter((p) => p.id !== po.id)]);
  /** A block decided or unlocked: in or out of each queue, and its PO's numbers refreshed. */
  const placeBlock = async (b: Block) => {
    const inQueue = (status: string) => b.bundles.some((x) => x.status === status);
    setReview((list) => (inQueue('review') ? [b, ...list.filter((x) => x.id !== b.id)] : list.filter((x) => x.id !== b.id)));
    setFinal((list) => (inQueue('final') ? [b, ...list.filter((x) => x.id !== b.id)] : list.filter((x) => x.id !== b.id)));
    try { placePo((await api.getPo(b.poId)).po); } catch { /* the list catches up on the next load */ }
  };

  return {
    meta, pos, review, final, suppliers, loading: loading || !meta, error, scope, setScope,
    reload: () => { loadPos(); loadQueues(); loadSuppliers(); },
    reloadSuppliers: loadSuppliers,
    placePo, placeBlock,
    setSuppliers
  };
}

export type SupplierPosData = ReturnType<typeof useSupplierPos>;
