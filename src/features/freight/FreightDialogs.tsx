import { homeLocationOf, locationNames } from '../../utils/locationFilter';
import { CARRIERS } from '../../accounting/permissions';
import { has, plural } from './freightView';
import * as api from './freightApi';
import { paidToast } from './useFreightActions';
import PayForm from './forms/PayForm';
import VoidForm from './forms/VoidForm';
import ChargeForm from './forms/ChargeForm';
import CarrierForm from './forms/CarrierForm';
import InvoiceForm from './forms/InvoiceForm';
import type { Carrier, FreightCharge, FreightForm, FreightPanel, FreightToast, FreightUser } from './types';

export type FreightDialogsProps = {
  form: FreightForm | null;
  user: FreightUser;
  carriers: Carrier[];
  /** The branches this login may use (accessibleLocations) and the one the list shows. */
  branchOptions: string[];
  location: string;
  onClose: () => void;
  /** A save landed: close the form, clear the selection, reload, show the toast. */
  done: (message?: FreightToast) => void;
  onOpenPanel: (panel: FreightPanel) => void;
};

/**
 * The form open over the page and what its save sends: pay charges (one-step
 * Approve & pay or Mark paid, one PAY- id), pay an invoice, void a charge or an
 * invoice, add / edit a charge, enter / edit a carrier invoice (a new one opens
 * its panel), add / edit / deactivate a carrier.
 */
export default function FreightDialogs({ form, user, carriers, branchOptions, location, onClose: closeForm, done, onOpenPanel }: FreightDialogsProps) {
  const carrierName = (id: unknown) => carriers.find((c) => String(c._id) === String(id))?.name || 'Carrier';
  return (
    <>
      {form?.type === 'pay' ? (() => {
        const cs = form.charges;
        const oneStep = cs.some((c) => c.status === 'draft');
        const n = plural(cs.length, 'charge');
        const sos = cs.map((c: FreightCharge) => c.soNumber).filter(Boolean);
        return (
          <PayForm
            title={oneStep ? 'Approve & pay' : 'Mark paid'}
            kicker={`${cs[0].carrier?.name || carrierName(cs[0].carrierId)} · ${n}`}
            cents={cs.reduce((s: number, c: FreightCharge) => s + (c.amountCents || 0), 0)}
            sub={sos.length ? `SO# ${sos.slice(0, 8).join(', ')}${sos.length > 8 ? ` and ${sos.length - 8} more` : ''}` : ''}
            oneStep={oneStep}
            submitLabel={oneStep ? `Approve & pay ${n}` : `Mark ${n} paid`}
            onClose={closeForm}
            onPay={async (payment) => {
              const r = await api.payCharges(cs, payment);
              done(paidToast(r, n));
            }}
          />
        );
      })() : null}
      {form?.type === 'payInvoice' ? (
        <PayForm
          title={form.invoice.status === 'draft' ? 'Approve & pay invoice' : 'Pay invoice'}
          kicker={`${form.invoice.carrier?.name || 'Carrier'} · invoice #${form.invoice.invoiceNumber}`}
          cents={form.invoice.totalCents}
          sub={plural(form.invoice.chargeIds?.length || form.invoice.charges?.length || 0, 'charge')}
          oneStep={form.invoice.status === 'draft'}
          submitLabel={form.invoice.status === 'draft' ? 'Approve & pay invoice' : 'Mark invoice paid'}
          onClose={closeForm}
          onPay={async (payment) => {
            const r = await api.invoiceStep(form.invoice, 'pay', payment);
            done(paidToast(r, `invoice #${form.invoice.invoiceNumber}`));
          }}
        />
      ) : null}
      {form?.type === 'void' ? (
        <VoidForm title={<>Void charge <span className="fm-title-sub">· SO# {form.charge.soNumber || '—'}</span></>} submitLabel="Void charge" onClose={closeForm}
          onVoid={async (reason) => { await api.voidCharge(form.charge, reason); done({ text: 'Charge voided — it stays on record under All' }); }} />
      ) : null}
      {form?.type === 'voidInvoice' ? (
        <VoidForm title={<>Void invoice <span className="fm-title-sub">· #{form.invoice.invoiceNumber}</span></>} submitLabel="Void invoice" onClose={closeForm}
          onVoid={async (reason) => { await api.invoiceStep(form.invoice, 'void', { reason }); done({ text: 'Invoice voided — its charges are back waiting for approval' }); }} />
      ) : null}
      {form?.type === 'charge' ? (
        <ChargeForm
          charge={form.charge}
          carriers={carriers}
          user={user}
          branches={locationNames(branchOptions).length ? locationNames(branchOptions) : (user?.assignedLocations || []).filter((l: string) => l !== '*')}
          defaultBranch={location || homeLocationOf(user)}
          onClose={closeForm}
          onSave={async (body) => {
            if (form.charge) { await api.editCharge(form.charge, body); done({ text: 'Charge saved' }); }
            else { await api.addCharge(body); done({ text: 'Charge added — it’s waiting for approval' }); }
          }}
        />
      ) : null}
      {form?.type === 'invoice' ? (
        <InvoiceForm
          invoice={form.invoice}
          carriers={carriers}
          carrierId={form.carrierId}
          onClose={closeForm}
          onSave={async (body) => {
            if (form.invoice) { await api.editInvoice(form.invoice, body); done({ text: 'Invoice saved' }); }
            else {
              const inv = await api.addInvoice(body);
              done({ text: `Invoice #${inv.invoiceNumber} saved` });
              onOpenPanel({ type: 'invoice', id: String(inv._id) });
            }
          }}
        />
      ) : null}
      {form?.type === 'carrier' ? (
        <CarrierForm
          carrier={form.carrier}
          initialName={form.name}
          canDeactivate={has(user, CARRIERS.DEACTIVATE)}
          onClose={closeForm}
          onSave={async (body) => {
            if (form.carrier) { await api.editCarrier(form.carrier, body); done({ text: 'Carrier saved' }); }
            else { await api.addCarrier(body); done({ text: `${body.name} added — waiting charges with that name are matched to it` }); }
          }}
          onSetActive={async (active) => {
            await api.setCarrierActive(form.carrier!, active);
            done({ text: active ? 'Carrier reactivated' : 'Carrier deactivated' });
          }}
        />
      ) : null}
    </>
  );
}
