import { useCallback, useEffect, useRef, useState } from 'react';
import { usePagination } from '../../components/shared/paginationConfig';
import type { FuelMetadata, ReportDetail, ReportListItem } from '../../fuelman/types';
import { fuelApi } from './api';
export function useFuelMan(selectedId: string) {
  const [metadata, setMetadata] = useState<FuelMetadata | null>(null), [reports, setReports] = useState<ReportListItem[]>([]),
    [total, setTotal] = useState(0), [detail, setDetail] = useState<ReportDetail | null>(null),
    [error, setError] = useState(''), [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false), [reload, setReload] = useState(0);
  const pager = usePagination(), revision = useRef<number | null>(null), denied = useRef(false), metadataLoaded = useRef(false), manual = useRef(false);
  const live = useCallback(() => { setReload(v => v + 1); }, []);
  const refresh = useCallback(() => { manual.current = true; live(); }, [live]);
  const fail = useCallback((e: Error & { status?: number }) => {
    if (e.status === 401 || e.status === 403) { denied.current = true; setDetail(null); setReports([]); setMetadata(null); }
    setError(e.message);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setLoading(true);
    // Locations and drivers change rarely; read them on the first load and on a manual refresh, not on every live update.
    if (!metadataLoaded.current || manual.current) {
      manual.current = false;
      void fuelApi.metadata(controller.signal).then(meta => { if (!controller.signal.aborted && !denied.current) { metadataLoaded.current = true; setMetadata(meta); } }).catch(e => { if (!controller.signal.aborted) fail(e); });
    }
    void fuelApi.reports(pager.currentPage, pager.rowsPerPage, controller.signal).then(result => {
      if (!controller.signal.aborted && !denied.current) { setReports(result.items); setTotal(result.total); }
    }).catch(e => { if (!controller.signal.aborted) fail(e); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pager.currentPage, pager.rowsPerPage, reload, fail]);
  useEffect(() => {
    if (!selectedId || denied.current) return;
    const controller = new AbortController(); setDetailLoading(true); setError('');
    setDetail(old => old?.id === selectedId ? old : null);
    void fuelApi.detail(selectedId, controller.signal).then(next => { if (!controller.signal.aborted && !denied.current) setDetail(next); })
      .catch(e => { if (!controller.signal.aborted) fail(e); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, reload, fail]);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const check = async () => {
      if (pending || denied.current || document.visibilityState === 'hidden' || !navigator.onLine) return;
      pending = true;
      try {
        const result = await fuelApi.revision(controller.signal);
        if (!controller.signal.aborted) { if (revision.current !== null && revision.current !== result.revision) live(); revision.current = result.revision; }
      } catch (e) { if (!controller.signal.aborted && [401, 403].includes((e as { status?: number }).status || 0)) fail(e as Error); }
      finally { pending = false; }
    };
    void check(); const timer = setInterval(() => void check(), 30000);
    window.addEventListener('online', check); document.addEventListener('visibilitychange', check);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check); };
  }, [live, fail]);
  return { metadata, reports, total, detail: detail?.id === selectedId ? detail : null, error, loading, detailLoading, refresh, pager, reload };
}
