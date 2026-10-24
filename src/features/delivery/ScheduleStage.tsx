import { RefreshCw, AlertTriangle, ArrowUpToLine, Link2, X } from 'lucide-react';
import BoardGrid from './board/BoardGrid';
import DriverView from './driver/DriverView';
import PendingDeliveries from './board/PendingDeliveries';
import CancelledOrders from './board/CancelledOrders';
import type { ConnectionStatus } from '../../api/deliverySchedule';
import type { CurrentUser } from '../../types/records';
import type { Assignment, BoardColumn, ScheduleRole, StopOrder, Ticket } from './types';

export type ScheduleStageProps = {
  role: ScheduleRole;
  currentUser: CurrentUser | null;
  loading: boolean;
  loadError: string | null;
  loadData: (forceRefresh?: boolean) => void;
  submittedDayNotice: string;
  setSubmittedDayNotice: (notice: string) => void;
  trucks: BoardColumn[];
  deliveries: Ticket[];
  pending: Ticket[];
  cancelled: Ticket[];
  visibleDates: string[];
  todayRequest: number;
  searchQuery: string;
  columnOrder: string[] | null;
  connection: ConnectionStatus;
  handleOpenAddModal: (truckId?: string | null, dateStr?: string | null) => void;
  handleOpenAddPending: () => void;
  handleOpenEditModal: (delivery: Ticket) => void;
  handleUpdateTruck: (id: string, newName: string, newDriver: string) => void;
  handleMoveDelivery: (id: string, assignment: Assignment) => unknown;
  handleReorderDeliveries: (updates: StopOrder[]) => unknown;
  handleMoveToPending: (id: string) => unknown;
  handleMoveToCancelled: (id: string) => unknown;
  handleUpdateStatus: (id: string, status: string) => Promise<unknown>;
  handleOpenPod: (delivery: Ticket) => void;
  handleOpenPodViewer: (delivery: Ticket) => void;
  handleRefresh: () => Promise<unknown>;
};

/** Below the toolbar: the loader, or the board (office / read-only) with Pending and Cancelled, or the driver's stops. */
export default function ScheduleStage({
  role, currentUser, loading, loadError, loadData, submittedDayNotice, setSubmittedDayNotice, trucks, deliveries,
  pending, cancelled, visibleDates, todayRequest, searchQuery, columnOrder, connection, handleOpenAddModal,
  handleOpenAddPending, handleOpenEditModal, handleUpdateTruck, handleMoveDelivery, handleReorderDeliveries,
  handleMoveToPending, handleMoveToCancelled, handleUpdateStatus, handleOpenPod, handleOpenPodViewer, handleRefresh
}: ScheduleStageProps) {
  /* ── MAIN CONTENT ── */
  return loading ? (
    <div className="manifest-loading-box">
      <RefreshCw size={24} className="spin-icon" />
      <span>Loading Dispatch Manifest...</span>
    </div>
  ) : (
    <div className="manifest-role-stage">
      {/* The driver view renders its own, alongside the connection state. */}
      {loadError && role !== 'driver' && (
        <div className="manifest-load-error" role="alert">
          <AlertTriangle size={16} />
          <span>{loadError}</span>
          <button type="button" onClick={() => loadData(true)}>Retry</button>
        </div>
      )}

      {submittedDayNotice && role === 'office' && (
        <div className="manifest-submitted-day" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{submittedDayNotice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setSubmittedDayNotice('')}><X size={14} /></button>
        </div>
      )}

      {role === 'office' && (
        <BoardGrid
          trucks={trucks}
          deliveries={deliveries}
          pending={pending}
          cancelled={cancelled}
          weekDates={visibleDates}
          todayRequest={todayRequest}
          searchQuery={searchQuery}
          editable={true}
          onAddDelivery={handleOpenAddModal}
          onEditDelivery={handleOpenEditModal}
          onUpdateTruck={handleUpdateTruck}
          onMoveDelivery={handleMoveDelivery}
          onReorderDeliveries={handleReorderDeliveries}
          columnOrder={columnOrder}
          onViewPod={handleOpenPodViewer}
          // Pickups are signed for at the counter rather than at a jobsite,
          // so the office captures their ePOD. The board only offers it on
          // the columns nobody drives.
          onOpenPod={handleOpenPod}
        />
      )}

      {role === 'sales' && (
        <BoardGrid
          trucks={trucks}
          deliveries={deliveries}
          weekDates={visibleDates}
          todayRequest={todayRequest}
          searchQuery={searchQuery}
          columnOrder={columnOrder}
          editable={false}
          onEditDelivery={null}
          onViewPod={handleOpenPodViewer}
        />
      )}

      {(role === 'office' || role === 'sales') && (
        <PendingDeliveries
          pending={pending}
          searchQuery={searchQuery}
          editable={role === 'office'}
          onAddPending={handleOpenAddPending}
          onEditDelivery={handleOpenEditModal}
          onViewPod={handleOpenPodViewer}
          onMoveToPending={role === 'office' ? handleMoveToPending : undefined}
        />
      )}

      {(role === 'office' || role === 'sales') && (
        <CancelledOrders
          cancelled={cancelled}
          searchQuery={searchQuery}
          editable={role === 'office'}
          onEditDelivery={handleOpenEditModal}
          onViewPod={handleOpenPodViewer}
          onMoveToCancelled={role === 'office' ? handleMoveToCancelled : undefined}
        />
      )}

      {/* Below Pending Deliveries and Cancelled Orders rather than above
          the board, so it reads as a footnote for whoever is already
          dragging rather than a banner that eats into the space above the
          content. Only the office role can actually reorder/combine
          stops (BoardGrid's onReorderDeliveries is office-only), so the
          hint is too. */}
      {role === 'office' && (
        <p className="reorder-hint">
          <ArrowUpToLine size={12} /> Drop above or below a stop to reorder it &nbsp;·&nbsp;
          <Link2 size={12} /> drop onto a stop to combine it as the same delivery
        </p>
      )}

      {role === 'driver' && (
        <DriverView
          trucks={trucks}
          deliveries={deliveries}
          weekDates={visibleDates}
          currentUser={currentUser}
          onUpdateStatus={handleUpdateStatus}
          onOpenPod={handleOpenPod}
          onViewPod={handleOpenPodViewer}
          connection={connection}
          onRefresh={handleRefresh}
          loadError={loadError}
        />
      )}
    </div>
  );
}
