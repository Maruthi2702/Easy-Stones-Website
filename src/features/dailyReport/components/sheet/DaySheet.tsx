import type { RefObject } from 'react';
import { ClipboardList, Lock } from 'lucide-react';
import ReportSection from '../ReportSection';
import DaySummary from '../DaySummary';
import VisitorsSection from './VisitorsSection';
import DeliverySection from './DeliverySection';
import TransfersSection from './TransfersSection';
import ContainersSection from './ContainersSection';
import PaymentsSection from './PaymentsSection';
import { longDate } from '../../reportFigures';
import type { SheetEditors } from '../../sheetEditing';
import type { DayTotals, Report, ShippedEarlierGroup, SlabRange } from '../../types';

export type DaySheetProps = {
  report: Report;
  totals: DayTotals;
  date: string;
  location: string;
  submitted: boolean;
  saving: boolean;
  dirty: boolean;
  savedAt: Date | null;
  canEdit: boolean;
  canSubmit: boolean;
  locked: boolean;
  submitDay: () => void;
  editors: SheetEditors;
  slabRange: SlabRange | null;
  shippedEarlier: ShippedEarlierGroup[];
  setDate: (date: string) => void;
  routeLocations: string[];
  compactRoutes: boolean;
  transferTableRef: RefObject<HTMLTableElement | null>;
  touchCapacity: (key: string) => void;
  touchTransferSlabs: (key: string) => void;
};

/** One branch's day, ready to fill in: the status line, the day at a glance, and the six sections. */
export default function DaySheet({
  report, totals, date, location, submitted, saving, dirty, savedAt, canEdit, canSubmit, locked, submitDay,
  editors, slabRange, shippedEarlier, setDate, routeLocations, compactRoutes, transferTableRef, touchCapacity, touchTransferSlabs
}: DaySheetProps) {
  return (
    <>
      <div className="dr-statusline">
        <span className="dr-daylabel">{longDate(date)} · {location}</span>
        {submitted ? (
          <span className="dr-badge dr-badge--done">
            {/* An automatic submission means the figures stand as they were
                left at 11:59, not that anybody checked them — say which. */}
            <Lock size={11} /> {report.autoSubmitted
              ? 'Submitted automatically'
              : `Submitted${report.submittedBy ? ` by ${report.submittedBy}` : ''}`}
          </span>
        ) : (
          <span className="dr-badge">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Draft · saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Draft'}
          </span>
        )}
        {!canEdit && <span className="dr-badge">Read only</span>}
      </div>

      <div className="dr-sheet">
      {/* The day summarised, above the form that produces it. */}
      <DaySummary
        report={report}
        totals={totals}
        canSubmit={canSubmit && !submitted}
        onSubmit={submitDay}
        submitting={saving}
      />

      <div className="dr-grid">

        {/* Three to a row, in the order asked for:
            Visitors · Payments · Containers
            Delivery · Transfers · Notes */}

                    {/* Two columns, so the pairs are deliberate:
            Visitors  · Delivery
            Transfers · Containers   — slabs out beside slabs in,
            Payments  · Notes          the same pairing as the tiles above. */}

        {/* ── Visitors ── */}
        <VisitorsSection report={report} totals={totals} locked={locked} setPath={editors.setPath} />

        {/* ── Delivery & Pick-Up ── */}
        <DeliverySection report={report} totals={totals} locked={locked} setPath={editors.setPath} touchCapacity={touchCapacity} />

        {/* ── Transfers ── */}
        <TransfersSection
          report={report}
          totals={totals}
          locked={locked}
          date={date}
          location={location}
          routeLocations={routeLocations}
          compactRoutes={compactRoutes}
          transferTableRef={transferTableRef}
          shippedEarlier={shippedEarlier}
          slabRange={slabRange}
          setDate={setDate}
          patch={editors.patch}
          addTransfer={editors.addTransfer}
          rowKeys={editors.rowKeys}
          touchTransferSlabs={touchTransferSlabs}
        />

        {/* ── Containers ── */}
        <ContainersSection
          report={report}
          totals={totals}
          locked={locked}
          slabRange={slabRange}
          patch={editors.patch}
          addContainer={editors.addContainer}
          rowKeys={editors.rowKeys}
        />

        {/* ── Payments ── */}
        <PaymentsSection report={report} totals={totals} locked={locked} setPath={editors.setPath} declareNoPayments={editors.declareNoPayments} />

        {/* ── Notes ── */}
        <ReportSection title="Notes" icon={ClipboardList} source={{ kind: 'typed', label: 'optional' }}>
          <textarea
            className="dr-notes no-capitalize"
            value={report.notes}
            disabled={locked}
            placeholder="Anything about the day worth keeping — a late truck, a closed branch, a container held at the port."
            onChange={(e) => editors.setPath('notes', e.target.value)}
          />
        </ReportSection>

      </div>
      </div>
    </>
  );
}
