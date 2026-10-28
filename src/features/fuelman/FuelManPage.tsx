import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Fuel, Upload, RefreshCw } from 'lucide-react';
import { FUEL_MAN as P } from '../../fuelman/permissions';
import type { ExpenseLine, MissingIdentity, ReportDetail, ReviewDriver } from '../../fuelman/types';
import { useFuelMan } from './useFuelMan';
import { useFuelLocation } from './urlState';
import Tabs from './components/Tabs';
import ReportsHome from './components/ReportsHome';
import ReportReview from './components/ReportReview';
import MonthReview from './components/MonthReview';
import SetupReview from './components/SetupReview';
import { isSetupMonth } from './monthReview';
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
  { type: 'decision'; report: ReportDetail; action: Decision } | { type: 'classify'; report: ReportDetail; lines: ExpenseLine[] };
export default function FuelManPage({ sidebarToggle }: { currentUser?: { permissions?: string[] } | null; sidebarToggle?: ReactNode }) {
  const nav = useFuelLocation(), d = useFuelMan(nav.report), view = nav.view, [upload, setUpload] = useState(false), [uploadFiles, setUploadFiles] = useState<File[]>([]), [detailsFor, setDetailsFor] = useState(''), [form, setForm] = useState<Form | null>(null), [toast, setToast] = useState('');
  const meta = d.metadata, report = d.detail;
  // A draft being reconciled opens on the one-page monthly review; "Details" is the full tabbed view.
  const monthView = !!report && report.status === 'draft' && !!meta?.global && meta.permissions.includes(P.RECONCILE);
  const showDetails = !!report && (detailsFor === report.id || nav.tab !== 'drivers' || nav.unknownOnly);
  const saved = () => { setForm(null); setToast(form?.type === 'setup' || form?.type === 'assign' ? 'Driver matches saved. Later monthly reports reuse these drivers and locations automatically.' : 'Saved. Review totals have been refreshed.'); d.refresh(); };
  return <section className="fuel-man" aria-label="Fuel Man">
    <header className="fuel-header"><div className="fuel-title">{sidebarToggle}<Fuel size={24} /><div><h1>Fuel Man</h1><p>Fleet reports, driver review and location expenses.</p></div></div>
      <div className="fuel-actions"><button onClick={d.refresh} aria-label="Refresh Fuel Man"><RefreshCw size={16} />Refresh</button>
        {meta?.global && meta.permissions.includes(P.IMPORT) && <button className="fuel-primary" onClick={() => { setUploadFiles([]); setUpload(true); }}><Upload size={16} />Upload reports</button>}</div></header>
    <Tabs label="Fuel Man views" className="fuel-main-tabs" value={view} items={[{ id: 'reports', label: 'Reports' }, { id: 'totals', label: 'Location totals' }]}
      onChange={id => nav.go(id === 'totals' ? { view: 'totals', ...(!nav.report && d.reports[0] ? { report: d.reports[0].id } : {}) } : { view: 'reports' })} />
    {toast && <div role="status" className="fuel-toast">{toast}<button onClick={() => setToast('')} aria-label="Dismiss message">×</button></div>}
    {d.error && <div className="fuel-error" role="alert">{d.error}<button onClick={d.refresh}>Retry</button></div>}
    {view === 'reports' && <>
      {nav.report ? <><button className="fuel-back" onClick={() => nav.go({ report: '', tab: 'drivers' })}><ArrowLeft size={16} />All reports</button>
        {d.detailLoading && <p role="status">Refreshing report…</p>}
        {report && meta && monthView && !showDetails && (isSetupMonth(report)
          ? <SetupReview key={report.id} report={report} metadata={meta} reload={d.reload} onSaved={d.refresh} onMissing={missing => setForm({ type: 'missing', report, missing })}
            onClassify={lines => setForm({ type: 'classify', report, lines })} onDecision={action => setForm({ type: 'decision', report, action })} onDetails={() => setDetailsFor(report.id)} />
          : <MonthReview report={report} metadata={meta} reload={d.reload} onSaved={d.refresh} onAssign={driver => setForm({ type: 'assign', report, driver })} onMissing={missing => setForm({ type: 'missing', report, missing })}
            onClassify={lines => setForm({ type: 'classify', report, lines })} onDecision={action => setForm({ type: 'decision', report, action })} onDetails={() => setDetailsFor(report.id)} />)}
        {report && meta && monthView && showDetails && <button className="fuel-back" onClick={() => { setDetailsFor(''); nav.go({ tab: 'drivers' }, false); }}><ArrowLeft size={16} />Back to the summary</button>}
        {report && meta && (!monthView || showDetails) && <ReportReview key={report.id} report={report} metadata={meta} reload={d.reload} view={nav.tab} unknownOnly={nav.unknownOnly} onView={(tab, unknownOnly) => nav.go({ tab, unknownOnly: !!unknownOnly }, false)}
          onAssign={driver => setForm({ type: 'assign', report, driver })} onMissing={missing => setForm({ type: 'missing', report, missing })}
          onSetup={() => setForm({ type: 'setup', report })} onClassify={lines => setForm({ type: 'classify', report, lines })} onDecision={action => setForm({ type: 'decision', report, action })} />}
      </> : <ReportsHome metadata={meta} reports={d.reports} total={d.total} loading={d.loading} error={d.error} pager={d.pager} reload={d.reload}
        onOpen={id => nav.go({ report: id, view: 'reports', tab: 'drivers' })} onUpload={files => { setUploadFiles(files || []); setUpload(true); }} />}
    </>}
    {view === 'totals' && meta && (d.detailLoading && !report ? <p role="status">Loading location totals…</p> : report?.status === 'draft' && meta.global
      ? <DraftLocationTotals key={report.id} report={report} metadata={meta} reload={d.reload} onSetup={() => setForm({ type: 'setup', report })} />
      : <LocationTotals metadata={meta} initialMonth={report?.month || d.reports[0]?.month} reload={d.reload} />)}
    {upload && meta?.global && meta.permissions.includes(P.IMPORT) && <UploadForm initialFiles={uploadFiles} onClose={() => { setUpload(false); d.refresh(); }} onSaved={id => { setUpload(false); nav.go({ report: id, view: 'reports', tab: 'drivers' }); d.refresh(); setToast(''); }} />}
    {form?.type === 'setup' && meta?.global && meta.permissions.includes(P.RECONCILE) && <SetupDriversForm report={form.report} metadata={meta} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'assign' && meta && <AssignmentForm report={form.report} driver={form.driver} metadata={meta} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'missing' && meta?.global && <MissingForm report={form.report} missing={form.missing} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'decision' && meta?.global && <DecisionForm report={form.report} action={form.action} onClose={() => setForm(null)} onSaved={saved} />}
    {form?.type === 'classify' && meta?.global && <ClassificationForm report={form.report} lines={form.lines} onClose={() => setForm(null)} onSaved={saved} />}
  </section>;
}
