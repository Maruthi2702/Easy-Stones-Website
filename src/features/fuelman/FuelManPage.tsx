import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Fuel, Upload, RefreshCw } from 'lucide-react';
import Pagination from '../../components/shared/Pagination';
import { pageCount } from '../../components/shared/paginationConfig';
import { FUEL_MAN as P } from '../../fuelman/permissions';
import type { ExpenseLine, MissingIdentity, ReportDetail, ReviewDriver } from '../../fuelman/types';
import { useFuelMan } from './useFuelMan';
import ReportList from './components/ReportList';
import ReportReview from './components/ReportReview';
import LocationTotals from './components/LocationTotals';
import UploadForm from './forms/UploadForm';
import AssignmentForm from './forms/AssignmentForm';
import MissingForm from './forms/MissingForm';
import DecisionForm from './forms/DecisionForm';
import type { Decision } from './forms/DecisionForm';
import ClassificationForm from './forms/ClassificationForm';
import SetupDriversForm from './forms/SetupDriversForm';
import DraftLocationTotals from './components/DraftLocationTotals';
import './FuelMan.css';
type Form = { type: 'setup'; report: ReportDetail } | { type: 'assign'; report: ReportDetail; driver: ReviewDriver } | { type: 'missing'; report: ReportDetail; missing: MissingIdentity } |
  { type: 'decision'; report: ReportDetail; action: Decision } | { type: 'classify'; report: ReportDetail; line: ExpenseLine };
export default function FuelManPage({ sidebarToggle }: { currentUser?: { permissions?: string[] } | null; sidebarToggle?: ReactNode }) {
  const d = useFuelMan(), [view, setView] = useState('reports'), [upload, setUpload] = useState(false), [form, setForm] = useState<Form | null>(null), [toast, setToast] = useState('');
  const meta = d.metadata, report = d.detail;
  const saved = () => { setForm(null); setToast('Saved. Review totals have been refreshed.'); d.refresh(); };
  return <section className="fuel-man" aria-label="Fuel Man">
    <header className="fuel-header"><div className="fuel-title">{sidebarToggle}<Fuel size={24} /><div><h1>Fuel Man</h1><p>Fleet reports, driver review and location expenses.</p></div></div>
      <div className="fuel-actions"><button onClick={d.refresh} aria-label="Refresh Fuel Man"><RefreshCw size={16} />Refresh</button>
        {meta?.global && meta.permissions.includes(P.IMPORT) && <button className="fuel-primary" onClick={() => setUpload(true)}><Upload size={16} />Upload reports</button>}</div></header>
    <nav className="fuel-tabs fuel-main-tabs" aria-label="Fuel Man views"><button className={view === 'reports' ? 'active' : ''} onClick={() => setView('reports')}>Reports</button><button className={view === 'totals' ? 'active' : ''} onClick={() => { if (!d.selectedId && d.reports[0]) d.setSelectedId(d.reports[0].id); setView('totals'); }}>Location totals</button></nav>
    {toast && <div role="status" className="fuel-toast">{toast}<button onClick={() => setToast('')} aria-label="Dismiss message">×</button></div>}
    {d.error && <div className="fuel-error" role="alert">{d.error}<button onClick={d.refresh}>Retry</button></div>}
    {view === 'reports' && <>
      {d.selectedId ? <><button className="fuel-back" onClick={() => d.setSelectedId('')}><ArrowLeft size={16} />All reports</button>
        {d.detailLoading && <p role="status">Refreshing report…</p>}
        {report && meta && <ReportReview key={report.id} report={report} metadata={meta} reload={d.reload}
          onAssign={driver => setForm({ type: 'assign', report, driver })} onMissing={missing => setForm({ type: 'missing', report, missing })}
          onSetup={() => setForm({ type: 'setup', report })} onClassify={line => setForm({ type: 'classify', report, line })} onDecision={action => setForm({ type: 'decision', report, action })} />}
      </> : <div className="fuel-panel"><div className="fuel-section-heading"><div><h2>Monthly reports</h2><p className="fuel-muted">Upload once, remember assignments and review changes before publishing expenses.</p></div></div>
        {d.loading && <p role="status">Loading reports…</p>}
        {!!d.reports.length && <ReportList reports={d.reports} onOpen={d.setSelectedId} />}
        {!d.loading && !d.reports.length && !d.error && <div className="fuel-empty"><Fuel size={32} /><h3>{meta?.global ? 'Start with your Fuelman reports' : 'No published Fuel Man expenses yet'}</h3>
          <p>{meta?.global ? 'Upload the monthly Employee Management PDF. Assign reported IDs to your drivers and cost locations once; future reports reuse those assignments.' : 'Approved expenses for your locations will appear here. Company-wide uploads and driver review are handled by finance.'}</p>
          {meta?.global && meta.permissions.includes(P.IMPORT) && <button className="fuel-primary" onClick={() => setUpload(true)}>Upload first report</button>}</div>}
        <Pagination {...d.pager} totalPages={pageCount(d.total, d.pager.rowsPerPage)} totalCount={d.total} onPageChange={d.pager.setCurrentPage} onRowsPerPageChange={d.pager.setRowsPerPage} />
      </div>}
    </>}
    {view === 'totals' && meta && (d.detailLoading && !report ? <p role="status">Loading location totals…</p> : report?.status === 'draft' && meta.global
      ? <DraftLocationTotals key={report.id} report={report} metadata={meta} reload={d.reload} onSetup={() => setForm({ type: 'setup', report })} />
      : <LocationTotals metadata={meta} initialMonth={report?.month || d.reports[0]?.month} reload={d.reload} />)}
    {upload && meta?.global && meta.permissions.includes(P.IMPORT) && <UploadForm onClose={() => { setUpload(false); d.refresh(); }} onSaved={id => { setUpload(false); setView('reports'); d.setSelectedId(id); d.refresh(); setToast(''); }} />}
    {form?.type === 'setup' && meta?.global && meta.permissions.includes(P.RECONCILE) && <SetupDriversForm report={form.report} metadata={meta} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'assign' && meta && <AssignmentForm report={form.report} driver={form.driver} metadata={meta} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'missing' && meta?.global && <MissingForm report={form.report} missing={form.missing} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'decision' && meta?.global && <DecisionForm report={form.report} action={form.action} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'classify' && meta?.global && <ClassificationForm report={form.report} line={form.line} onClose={() => setForm(null)} onSaved={saved} />}
  </section>;
}
