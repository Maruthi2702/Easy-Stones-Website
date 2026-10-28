import { useCallback, useState } from 'react';
import type { DragEvent } from 'react';
import { Fuel } from 'lucide-react';
import type { FuelMetadata, ReportListItem } from '../../../fuelman/types';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import Pagination from '../../../components/shared/Pagination';
import { pageCount } from '../../../components/shared/paginationConfig';
import type { usePagination } from '../../../components/shared/paginationConfig';
import { fuelApi } from '../api';
import { money, monthName } from '../format';
import { currentStep, nextAction, reviewSteps } from '../progressSteps';
import { useFuelQuery } from '../useFuelQuery';
import ReportList from './ReportList';
function HeroCard({ hero, reload, onOpen }: { hero: ReportListItem; reload: number; onOpen: (id: string) => void }) {
  const read = useCallback((signal: AbortSignal) => fuelApi.detail(hero.id, signal), [hero.id]);
  const detail = useFuelQuery(JSON.stringify([hero.id, hero.totalCents, reload]), read).data;
  const steps = detail ? reviewSteps(detail) : [], at = detail ? steps.findIndex(s => s.key === currentStep(steps)) : -1;
  return <section className="fuel-home-hero" aria-label="Month that needs you">
    <div><span className="fuel-status draft">Your turn</span><h2>{monthName(hero.month)}</h2><p className="fuel-muted">{hero.company} · {hero.lineCount} charges</p>
      {detail && <div className="fuel-home-progress"><div><span>Step {at + 1} of 4</span><span>Next: {nextAction(detail)}</span></div>
        <div className="fuel-mr-track" role="img" aria-label={`Step ${at + 1} of 4`}><i style={{ width: `${(at + 1) * 25}%` }} /></div></div>}</div>
    <div className="fuel-home-total"><span className="fuel-muted">Report total</span><strong>{money(hero.totalCents)}</strong><button className="fuel-primary" onClick={() => onOpen(hero.id)}>Continue review →</button></div>
  </section>;
}
// The Reports page: the month that needs you, then every month (design: canvas board 1).
export default function ReportsHome({ metadata, reports, total, loading, error, pager, reload, onOpen, onUpload }: {
  metadata: FuelMetadata | null; reports: ReportListItem[]; total: number; loading: boolean; error: string; reload: number;
  pager: ReturnType<typeof usePagination>; onOpen: (id: string) => void; onUpload: (files?: File[]) => void;
}) {
  const canReview = !!metadata?.global && metadata.permissions.includes(P.RECONCILE), canImport = !!metadata?.global && metadata.permissions.includes(P.IMPORT);
  const hero = canReview ? [...reports].filter(r => r.status === 'draft').sort((a, b) => a.month.localeCompare(b.month))[0] : undefined;
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); const files = [...e.dataTransfer.files].filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf'); if (files.length) onUpload(files); };
  return <>
    {hero && <HeroCard hero={hero} reload={reload} onOpen={onOpen} />}
    <div className="fuel-section-heading"><h2 className="fuel-home-h">All months</h2></div>
    {loading && <p role="status">Loading reports…</p>}
    {!!reports.length && <div className="fuel-panel fuel-home-table"><ReportList reports={reports} onOpen={onOpen} /></div>}
    {!loading && !reports.length && !error && <div className="fuel-empty"><Fuel size={32} /><h3>{metadata?.global ? 'Start with your Fuelman reports' : 'No approved Fuel Man expenses yet'}</h3>
      <p>{metadata?.global ? 'Upload the monthly Employee Management PDF. Match each reported card to a driver and location once; every later month reuses it.' : 'Approved expenses for your locations will appear here. Uploads and driver review are handled by the people who manage Fuel Man.'}</p></div>}
    <Pagination {...pager} totalPages={pageCount(total, pager.rowsPerPage)} totalCount={total} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
    {canImport && <div className={`fuel-dropzone${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div><strong>{reports.length ? 'Add another month' : 'Upload a report'}</strong><p className="fuel-muted">Drop the Employee Management PDF here. Select several months at once; review starts with the earliest.</p></div>
      <button onClick={() => onUpload()}>Choose PDF files</button></div>}
  </>;
}
