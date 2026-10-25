import { useState, useEffect, useCallback, useRef } from 'react';
import type { Metadata, Plan, Draft, InboundRow } from '../../purchasing/types';
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
    [error, setError] = useState(''),
    [loading, setLoading] = useState(!initial.metadata || (!!initial.scopeId && !initial.data)),
    [revision, setRevision] = useState(0);
  const loadedScope = useRef(initial.scopeId);
  const denied = useCallback((err: { status?: number }) => {
    if (err.status === 401 || err.status === 403) {
      purchasingCache.invalidate();
      setPlan(null);
      setMetadata(null);
      setDrafts([]);
      setInbound([]);
      setScopeId('');
    }
  }, []);
  const refresh = useCallback(() => {
    purchasingCache.invalidate();
    setRevision((v) => v + 1);
  }, []);
  useEffect(() => {
    const timer = setTimeout(refresh, purchasingCache.refreshIn(scopeId, refreshSignal));
    return () => clearTimeout(timer);
  }, [refresh, revision, scopeId, refreshSignal]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const cached = purchasingCache.metadata(refreshSignal);
    (cached ? Promise.resolve(cached) : purchasingApi.metadata(controller.signal))
      .then((next) => {
        if (controller.signal.aborted) return;
        if (!cached) purchasingCache.saveMetadata(next, refreshSignal);
        setMetadata(next);
        setScopeId((old) => {
          const preferred = old || purchasingCache.selectedScope();
          return next.scopes.some(s => s._id === preferred) ? preferred! : next.scopes[0]?._id || '';
        });
        if (!next.scopes.length) {
          setPlan(null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          denied(err);
          setError(err.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [revision, refreshSignal, denied]);
  useEffect(() => {
    if (!scopeId) return;
    const controller = new AbortController();
    purchasingCache.selectScope(scopeId);
    const cached = purchasingCache.scope(scopeId, refreshSignal);
    if (cached) {
      setPlan(cached.plan);
      setDrafts(cached.drafts);
      setInbound(cached.inbound);
      loadedScope.current = scopeId;
      setLoading(false);
      return;
    }
    setLoading(true);
    if (loadedScope.current !== scopeId) {
      setPlan(null);
      setDrafts([]);
      setInbound([]);
      loadedScope.current = scopeId;
    }
    setError('');
    Promise.all([
      purchasingApi.plan(scopeId, controller.signal),
      purchasingApi.drafts(scopeId, controller.signal),
      purchasingApi.inbound(scopeId, controller.signal),
    ])
      .then(([next, history, supply]) => {
        if (controller.signal.aborted) return;
        purchasingCache.saveScope(scopeId, { plan: next, drafts: history, inbound: supply?.rows || [] }, refreshSignal);
        setPlan(next);
        setDrafts(history);
        setInbound(supply?.rows || []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          denied(err);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [scopeId, revision, refreshSignal, denied]);
  return {
    metadata,
    scopeId,
    setScopeId,
    plan: plan?.scope._id === scopeId ? plan : null,
    drafts,
    inbound,
    error,
    loading,
    refresh,
  };
}
