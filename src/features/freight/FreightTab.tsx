import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import FreightHeader from './list/FreightHeader';
import Pagination from '../../components/shared/Pagination';
import { FREIGHT } from '../../accounting/permissions';
import { groupByCarrier, has, selectionActions } from './freightView';
import { useFreightData } from './useFreightData';
import { useFreightSelection } from './useFreightSelection';
import { useFreightActions } from './useFreightActions';
import { useFreightExport } from './useFreightExport';
import { SummaryTiles, StatusTabs } from './list/SummaryTiles';
import ChargeList from './list/ChargeList';
import { chargeCells } from './list/chargeCells';
import SelectionBar from './list/SelectionBar';
import ToastBar from './list/ToastBar';
import { ChargePanel } from './panels/ChargePanel';
import { InvoicePanel } from './panels/InvoicePanel';
import { PaymentPanel } from './panels/PaymentPanel';
import { CarriersPanel } from './panels/CarriersPanel';
import FreightDialogs from './FreightDialogs';
import type { Loose } from '../../types/records';
import type { FreightUser } from './types';
import './Freight.css';

export type FreightTabProps = { currentUser: FreightUser; locationsList?: Loose[]; sidebarToggle?: ReactNode };

/**
 * Accounting · 3rd-Party Freight: what we owe contract carriers for completed
 * 3rd-party deliveries, approved and paid here. Built from the "Accounting ·
 * 3rd-Party Freight" canvas; rules in freightView.ts and src/accounting/. The
 * server checks every permission and branch again. The list's data is
 * useFreightData, the ticks useFreightSelection, the buttons useFreightActions;
 * the side panels are panels/, the forms forms/ (opened by FreightDialogs).
 */
export default function FreightTab({ currentUser, locationsList = [], sidebarToggle = null }: FreightTabProps) {
  const user = currentUser;
  const selection = useFreightSelection();
  const list = useFreightData(user, locationsList, selection.clear);
  const {
    tab, setTab, search, setSearch, debounced, branchOptions, location, setLocation, carrierId, setCarrierId,
    currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, data, items, summary, loading, error, setError, carriers, reloadKey, refresh
  } = list;
  const { panel, setPanel, form, setForm, toast, setToast, busy, act, closeForm, done } = useFreightActions({ refresh, setError, clearSelection: selection.clear });
  const { exporting, exportExcel } = useFreightExport({ tab, debounced, location, carrierId, setError, setToast });

  const groups = useMemo(() => groupByCarrier(items), [items]);
  const { selectedList } = selection;
  const bar = selectionActions(selectedList, user);

  const filterActive = Boolean(location) || Boolean(carrierId);
  const canAdd = has(user, FREIGHT.ADD);
  const showBranch = !location;
  const cells = chargeCells({ selection, busy, canAdd, onNewInvoice: act.newInvoice });

  return (
    <div className="fr">
      <div className="fr-page">
        <FreightHeader
          sidebarToggle={sidebarToggle}
          user={user}
          search={search}
          onSearch={setSearch}
          branchOptions={branchOptions}
          location={location}
          onLocation={setLocation}
          carrierId={carrierId}
          onCarrier={setCarrierId}
          carriers={carriers}
          filterActive={filterActive}
          onClearFilters={() => { setLocation(''); setCarrierId(''); }}
          canAdd={canAdd}
          exporting={exporting}
          onCarriers={() => setPanel({ type: 'carriers' })}
          onNewInvoice={() => act.newInvoice(null)}
          onExport={exportExcel}
          onAddCharge={() => setForm({ type: 'charge', charge: null })}
        />

        <SummaryTiles summary={summary} onReview={() => setTab('to_approve')} />
        <StatusTabs tab={tab} summary={summary} onTab={setTab} />

        {error ? (
          <div className="fr-note error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span className="fr-grow">{error}</span>
            <button type="button" className="fr-btn sm" onClick={() => { setError(''); refresh(); }}>Retry</button>
          </div>
        ) : null}

        <ChargeList data={data} items={items} groups={groups} loading={loading} tab={tab} filtered={Boolean(debounced || filterActive)}
          showBranch={showBranch} cells={cells} onOpen={act.openCharge} />

        {data && data.total > 0 ? (
          <div className="fr-pager">
            <Pagination currentPage={currentPage} totalPages={Math.max(1, Math.ceil(data.total / rowsPerPage))} onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={data.total} />
          </div>
        ) : null}
      </div>

      {bar.count > 0 && !panel ? (
        <SelectionBar bar={bar} busy={busy} onClear={selection.clear} onSendBack={() => act.sendBack(selectedList)}
          onApprove={() => act.approve(selectedList)} onPay={() => act.pay(selectedList)} />
      ) : null}

      {toast ? (
        <ToastBar toast={toast} onViewPayment={(id) => { setPanel({ type: 'payment', id }); setToast(null); }} onDismiss={() => setToast(null)} />
      ) : null}

      {panel?.type === 'charge' ? <ChargePanel id={panel.id} user={user} reloadKey={reloadKey} act={act} onClose={() => setPanel(null)} /> : null}
      {panel?.type === 'invoice' ? <InvoicePanel id={panel.id} user={user} reloadKey={reloadKey} act={act} onClose={() => setPanel(null)} /> : null}
      {panel?.type === 'payment' ? <PaymentPanel paymentId={panel.id} act={act} onClose={() => setPanel(null)} /> : null}
      {panel?.type === 'carriers' ? <CarriersPanel user={user} reloadKey={reloadKey} act={act} onClose={() => setPanel(null)} /> : null}

      <FreightDialogs form={form} user={user} carriers={carriers} branchOptions={branchOptions} location={location}
        onClose={closeForm} done={done} onOpenPanel={setPanel} />
    </div>
  );
}
