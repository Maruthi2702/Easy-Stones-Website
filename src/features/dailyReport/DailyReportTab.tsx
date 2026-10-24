import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import NoBranchNote from './components/NoBranchNote';
import { authFetch } from '../../api/authFetch';
import { orderLocations } from '../../utils/locationFilter';
import MonthView from './components/MonthView';
import AllBranchesDay from './components/AllBranchesDay';
import EmailReportDialog from './components/EmailReportDialog';
import PdfPreviewDialog from './components/PdfPreviewDialog';
import ReportTopBar from './components/ReportTopBar';
import DaySheet from './components/sheet/DaySheet';
import ReopenDialog from './components/ReopenDialog';
import { useLocationFilter } from '../../components/shared/useLocationFilter';
import './DailyReport.css';
import { todayISO, monthOf } from '../../components/shared/calendar/calendarDates';
import { API_URL } from '../../config/api';
import { ALL, longDate, reportTotals } from './reportFigures';
import { sheetEditors } from './sheetEditing';
import { useDaySheet } from './useDaySheet';
import { useReportLocations } from './useReportLocations';
import { useCompactRoutes } from './useCompactRoutes';
import { csvUrlFor, emailUrlFor, exportMenuItems, monthLabelOf, pdfNameFor, pdfUrlFor } from './reportExports';
import type { Loose } from '../../types/records';
import type { DayTotals } from './types';

/**
 * Daily Work Report — the spreadsheet the branches filled in every evening.
 *
 * Half of it the system already knows: the visitor count comes from the
 * check-in log and the assigned deliveries and pick-ups from the schedule.
 * Those arrive filled in and marked, and stay editable — if someone walked in
 * without signing the kiosk, the person on shift is right and the system isn't.
 *
 * Loading, autosaving and submitting one branch's day is useDaySheet; this
 * page holds which day, branch and view are on screen and lays the parts out.
 */

// Date arithmetic for the day / month steppers lives with the calendar
// (src/components/shared/calendar/calendarDates.ts): one date carries both
// views, so moving a month keeps the day number where it can (clamped).

export type DailyReportTabProps = {
  currentUser?: Loose | null;
  /** The page's menu button, from the shell. */
  sidebarToggle?: ReactNode;
};

const DailyReportTab = ({ currentUser = null, sidebarToggle = null }: DailyReportTabProps) => {
  const perms = (currentUser?.permissions as string[] | undefined) || [];
  const canEdit = perms.includes('edit_daily_report');
  const canSubmit = perms.includes('submit_daily_report');
  const canReopen = perms.includes('reopen_daily_report');

  const [view, setView] = useState('day');           // 'day' | 'month'
  const [date, setDate] = useState(todayISO);
  const [error, setError] = useState<string | null>(null);
  // ── which branches this person may report on ──────────────────────────────
  const { locations, allLocations, canExportAll } = useReportLocations(setError);
  // The branch on screen, or ALL for the read-only every-branch summary.
  // Opens on this person's home location (Users & Roles); the shared filter's
  // All ('') is this sheet's ALL. With a single branch there's no choice and
  // no All — it's always that branch's own sheet.
  const [locationPick, setLocationPick] = useLocationFilter('dailyReport', currentUser, locations);
  const location = locations.length > 1 ? (locationPick || ALL) : (locations[0] || '');
  const setLocation = (loc: string) => setLocationPick(loc === ALL ? '' : loc);
  // The Transfer row's From / To cells: this report's branch first (every
  // route starts or ends there), then the rest A–Z — the shared location order.
  const routeLocations = useMemo(() => orderLocations(allLocations, location), [allLocations, location]);

  const {
    report, setReport, loading, saving, savedAt, dirty, slabRange, shippedEarlier, noBranchTickets,
    loadDay, submitDay, touchCapacity, touchTransferSlabs
  } = useDaySheet({ date, location, view, canEdit, setError });
  const { transferTableRef, compactRoutes } = useCompactRoutes(Boolean(report), view);

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const allBranches = location === ALL;

  // ── editing helpers ───────────────────────────────────────────────────────
  const locked = !canEdit || report?.status === 'submitted';
  const editors = sheetEditors(setReport, locked);

  // ── totals, computed and never typed ──────────────────────────────────────
  const totals = useMemo(() => reportTotals(report), [report]);

  const reopenDay = async () => {
    const res = await authFetch(`${API_URL}/api/daily-reports/${date}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ location, reason: reopenReason })
    });
    if (res.ok) {
      setReopenOpen(false);
      setReopenReason('');
      loadDay();
    } else {
      setError((await res.json()).message);
    }
  };

  const scope = { view, date, location };
  const exportCsv = (which: 'all' | 'branch') => {
    window.open(csvUrlFor(date, which, location), '_blank', 'noopener');
  };
  const pdfUrl = pdfUrlFor(scope);
  const downloadPdf = () => window.open(pdfUrl, '_blank', 'noopener');
  const viewPdf = () => setPreviewOpen(true);

  const emailReport = async ({ to, message }: { to: string[]; message: string }) => {
    const res = await authFetch(emailUrlFor(scope), {
      method: 'POST',
      body: JSON.stringify({ location, to, message })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not send the report.');
    return data;
  };

  const pdfName = pdfNameFor(scope);
  const monthLabel = monthLabelOf(date);
  const scopeLabel = allBranches ? 'your branches' : location;
  const exportItems = exportMenuItems({
    ...scope, allBranches, canExportAll, scopeLabel, monthLabel,
    onDownloadPdf: downloadPdf, onEmail: () => setEmailOpen(true), onViewPdf: viewPdf, onCsv: exportCsv
  });

  // ── render ────────────────────────────────────────────────────────────────
  if (!perms.includes('view_daily_report')) {
    return (
      <div className="dr-root">
        <div className="dr-empty">
          <AlertCircle size={34} />
          <p>You don't have access to the Daily Report.</p>
          <span>Ask an administrator for the <strong>View</strong> permission under Daily Report.</span>
        </div>
      </div>
    );
  }

  const submitted = report?.status === 'submitted';

  return (
    <div className="dr-root">
      <ReportTopBar
        sidebarToggle={sidebarToggle}
        view={view}
        setView={setView}
        date={date}
        setDate={setDate}
        locations={locations}
        location={location}
        setLocation={setLocation}
        currentUser={currentUser}
        exportItems={exportItems}
        allBranches={allBranches}
        submitted={submitted}
        canSubmit={canSubmit}
        canReopen={canReopen}
        submitDay={submitDay}
        loading={loading}
        report={report}
        saving={saving}
        setReopenOpen={setReopenOpen}
      />

      {error && (
        <div className="dr-error" role="alert">
          <AlertCircle size={16} /> <span>{error}</span>
        </div>
      )}

      {view === 'day' && !allBranches && <NoBranchNote count={noBranchTickets} />}

      {view === 'month' ? (
        <MonthView
          month={monthOf(date)}
          location={location}
          locations={locations}
          authFetch={authFetch}
          onOpenDay={(d, loc) => {
            setDate(d);
            if (loc) setLocation(loc);
            setView('day');
          }}
        />
      ) : allBranches ? (
        <AllBranchesDay
          date={date}
          authFetch={authFetch}
          onOpenBranch={(loc) => setLocation(loc)}
        />
      ) : loading ? (
        <div className="dr-empty"><Loader2 size={30} className="dr-spin" /><p>Loading {longDate(date)}…</p></div>
      ) : !report ? (
        <div className="dr-empty"><AlertCircle size={30} /><p>Nothing to show for this day.</p></div>
      ) : (
        <DaySheet
          report={report}
          totals={totals as DayTotals}
          date={date}
          location={location}
          submitted={submitted}
          saving={saving}
          dirty={dirty}
          savedAt={savedAt}
          canEdit={canEdit}
          canSubmit={canSubmit}
          locked={locked}
          submitDay={submitDay}
          editors={editors}
          slabRange={slabRange}
          shippedEarlier={shippedEarlier}
          setDate={setDate}
          routeLocations={routeLocations}
          compactRoutes={compactRoutes}
          transferTableRef={transferTableRef}
          touchCapacity={touchCapacity}
          touchTransferSlabs={touchTransferSlabs}
        />
      )}

      <EmailReportDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSend={emailReport}
        title={view === 'month' ? `Email the ${monthOf(date)} summary` : `Email ${longDate(date)}`}
        subtitle={view === 'month'
          ? `The month for ${location}.`
          : `${location}${report?.status === 'draft' ? ' — this day is still a draft and will be marked as one.' : '.'}`}
        filename={pdfName}
      />

      <PdfPreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        url={pdfUrl}
        title={view === 'month' ? `${monthOf(date)} · ${scopeLabel}` : `${longDate(date)} · ${location}`}
        filename={pdfName}
      />

      {/* Reopening a signed-off day states why, on the record. */}
      {reopenOpen && (
        <ReopenDialog
          date={date}
          reopenReason={reopenReason}
          setReopenReason={setReopenReason}
          setReopenOpen={setReopenOpen}
          reopenDay={reopenDay}
        />
      )}
    </div>
  );
};

export default DailyReportTab;
