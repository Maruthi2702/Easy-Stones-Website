import { useState, useEffect, useCallback, useRef } from 'react';
import type { Metadata, Plan, Draft, InboundRow } from '../../purchasing/types';
import { todayPacific } from '../../purchasing/planning';
import { purchasingApi } from './purchasingApi';
import { purchasingCache } from './purchasingCache';
export function usePurchasingData(refreshSignal: number) {
  const [initial] = useState(() => {
    const metadata = purchasingCache.metadata(refreshSignal);
    const selected = purchasingCache.selectedScope();
    const scopeId = metadata?.scopes.find(scope => scope._id === selected)?._id || metadata?.scopes[0]?._id || '';
    return { metadata, scopeId, data: purchasingCache.scope(scopeId, refreshSignal) };
  });
  const [metadata, setMetadata] = useState<Metadata | null>(initial.metadata || null),
    [scopeId, setScopeId] = useState(initial.scopeId),
    [plan, setPlan] = useState<Plan | null>(initial.data?.plan || null),
    [drafts, setDrafts] = useState<Draft[]>(initial.data?.drafts || []),
    [inbound, setInbound] = useState<InboundRow[]>(initial.data?.inbound || []),
    [nextCursor, setNextCursor] = useState<string | null>(initial.data?.nextCursor || null),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(!initial.metadata || (!!initial.scopeId && !initial.data?.plan)),
    [loadingMore, setLoadingMore] = useState(false),
    [revision, setRevision] = useState(0);
  const loadedScope = useRef(initial.scopeId), epoch = useRef(0);
  const currentPlan = useRef(plan);
  currentPlan.current = plan;
  const knownRevision = useRef<number | undefined>(initial.data?.plan?.revision ?? initial.metadata?.revision);
  const denied = useCallback((err: { status?: number }) => {
    if (err.status !== 401 && err.status !== 403) return false;
    epoch.current++;
    purchasingCache.invalidate();
    setPlan(null); setMetadata(null); setDrafts([]); setInbound([]); setScopeId(''); setLoading(false);
    return true;
  }, []);
  const refresh = useCallback(() => {
    epoch.current++;
    purchasingCache.invalidate();
    setRevision(v => v + 1);
  }, []);
  // Poll only a small revision number. Recompute on a source change, freshness
  // boundary or Pacific date rollover, never on an ordinary view switch.
  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === 'hidden' || !navigator.onLine) return;
      checking = true;
      try {
        const result = await purchasingApi.revision(controller.signal);
        if (controller.signal.aborted) return;
        const previous = knownRevision.current;
        knownRevision.current = result.revision;
        const p = currentPlan.current;
        if ((previous !== undefined && previous !== result.revision) ||
            (p && (p.today !== todayPacific(new Date()) || (p.validUntil && Date.parse(p.validUntil) <= Date.now())))) refresh();
      } catch (err) {
        if (!controller.signal.aborted && denied(err as { status?: number })) setErrors({ plan: 'Your purchasing access changed. Sign in again.' });
      } finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); };
  }, [refresh, denied]);
  useEffect(() => {
    const controller = new AbortController(), generation = epoch.current;
    const cached = purchasingCache.metadata(refreshSignal);
    (cached ? Promise.resolve(cached) : purchasingApi.metadata(controller.signal)).then(next => {
      if (controller.signal.aborted || generation !== epoch.current) return;
      if (!cached) purchasingCache.saveMetadata(next, refreshSignal);
      knownRevision.current = next.revision ?? knownRevision.current;
      setMetadata(next); setErrors(old => ({ ...old, metadata: '' }));
      setScopeId(old => {
        const preferred = old || purchasingCache.selectedScope();
        return next.scopes.some(s => s._id === preferred) ? preferred! : next.scopes[0]?._id || '';
      });
      if (!next.scopes.length) { setPlan(null); setLoading(false); }
    }).catch(err => {
      if (!controller.signal.aborted && generation === epoch.current) {
        denied(err); setErrors(old => ({ ...old, metadata: err.message })); setLoading(false);
      }
    });
    return () => controller.abort();
  }, [revision, refreshSignal, denied]);
  useEffect(() => {
    if (!scopeId) return;
    const controller = new AbortController(), generation = epoch.current;
    purchasingCache.selectScope(scopeId);
    const cached = purchasingCache.scope(scopeId, refreshSignal);
    if (loadedScope.current !== scopeId) {
      setPlan(cached?.plan || null); setDrafts(cached?.drafts || []); setInbound(cached?.inbound || []); setNextCursor(cached?.nextCursor || null);
      loadedScope.current = scopeId;
    }
    setLoading(!cached?.plan && currentPlan.current?.scope._id !== scopeId);
    setErrors({});
    const alive = () => !controller.signal.aborted && generation === epoch.current;
    const fail = (section: string, err: Error & { status?: number }) => {
      if (!alive()) return;
      if (denied(err)) controller.abort();
      setErrors(old => ({ ...old, [section]: err.message }));
    };
    if (!cached?.plan) void purchasingApi.plan(scopeId, controller.signal).then(next => {
      if (!alive()) return;
      purchasingCache.saveScope(scopeId, { plan: next }, refreshSignal);
      knownRevision.current = next.revision ?? knownRevision.current;
      setPlan(next);
    }).catch(err => fail('plan', err)).finally(() => { if (alive()) setLoading(false); });
    else { setPlan(cached.plan); setLoading(false); }
    if (!cached?.drafts) void purchasingApi.drafts(scopeId, controller.signal).then(page => {
      if (!alive()) return;
      purchasingCache.saveScope(scopeId, { drafts: page.items, nextCursor: page.nextCursor }, refreshSignal);
      setDrafts(page.items); setNextCursor(page.nextCursor);
    }).catch(err => fail('drafts', err));
    if (!cached?.inbound) void purchasingApi.inbound(scopeId, controller.signal).then(supply => {
      if (!alive()) return;
      const rows = supply?.rows || [];
      purchasingCache.saveScope(scopeId, { inbound: rows }, refreshSignal); setInbound(rows);
    }).catch(err => fail('inbound', err));
    return () => controller.abort();
  }, [scopeId, revision, refreshSignal, denied]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const generation = epoch.current, id = scopeId;
    setLoadingMore(true);
    try {
      const page = await purchasingApi.drafts(id, undefined, nextCursor);
      if (generation !== epoch.current || loadedScope.current !== id) return;
      setDrafts(old => [...new Map([...old, ...page.items].map(draft => [draft._id, draft])).values()]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (generation === epoch.current && loadedScope.current === id) { denied(err as { status?: number }); setErrors(old => ({ ...old, drafts: (err as Error).message })); }
    } finally { setLoadingMore(false); }
  };
  return { metadata, scopeId, setScopeId, plan: plan?.scope._id === scopeId ? plan : null, drafts, inbound,
    error: errors.plan || errors.metadata || '', errors, loading, refresh, loadMore, loadingMore, nextCursor };
}
