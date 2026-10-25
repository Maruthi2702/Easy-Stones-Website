import { useState, useEffect, useCallback, useRef } from 'react';
import type { Metadata, Plan, Draft, InboundRow } from '../../purchasing/types';
import { purchasingApi } from './purchasingApi';
export function usePurchasingData(refreshSignal: number) {
  const [metadata, setMetadata] = useState<Metadata | null>(null),
    [scopeId, setScopeId] = useState(''),
    [plan, setPlan] = useState<Plan | null>(null),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [inbound, setInbound] = useState<InboundRow[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const loadedScope = useRef('');
  const denied = useCallback((err: { status?: number }) => {
    if (err.status === 401 || err.status === 403) {
      setPlan(null);
      setMetadata(null);
      setDrafts([]);
      setInbound([]);
      setScopeId('');
    }
  }, []);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    purchasingApi
      .metadata(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setMetadata(next);
        setScopeId((old) => (next.scopes.some((s) => s._id === old) ? old : next.scopes[0]?._id || ''));
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
