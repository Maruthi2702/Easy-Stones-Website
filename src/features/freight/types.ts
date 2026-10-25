/**
 * The 3rd-Party Freight screen's shapes. Records stay loose (as /api/accounting
 * sends them, src/accounting/models.js); what's typed is how the screen's parts
 * talk to each other: which panel or form is open, and the actions they call.
 */
import type { ReactNode } from 'react';
import type { CurrentUser, Loose } from '../../types/records';
import type { FreightCharge } from './freightView';

export type { FreightCharge };
export type Carrier = Loose;
export type CarrierInvoice = Loose;
export type FreightPayment = Loose;
export type FreightUser = CurrentUser | null;

/** The side panel showing: a charge, an invoice, a payment (by its PAY- id), or the carrier list. */
export type FreightPanel = { type: 'charge' | 'invoice' | 'payment'; id: string } | { type: 'carriers'; id?: undefined };

/** The form (dialog) open over the page. */
export type FreightForm =
  | { type: 'pay'; charges: FreightCharge[] }
  | { type: 'void'; charge: FreightCharge }
  | { type: 'charge'; charge: FreightCharge | null }
  | { type: 'invoice'; invoice: CarrierInvoice | null; carrierId?: string }
  | { type: 'payInvoice'; invoice: CarrierInvoice }
  | { type: 'voidInvoice'; invoice: CarrierInvoice }
  | { type: 'carrier'; carrier: Carrier | null; name: string };

/** The toast at the foot of the page; a payment's carries its PAY- id. */
export type FreightToast = { text: ReactNode; paymentId?: string };

/** What the panels and the list can ask the page to do (the server checks each again). */
export type FreightActions = {
  approve: (charges: FreightCharge[]) => Promise<unknown>;
  sendBack: (charges: FreightCharge[]) => Promise<unknown>;
  review: (charge: FreightCharge) => Promise<unknown>;
  pay: (charges: FreightCharge[]) => void;
  voidCharge: (charge: FreightCharge) => void;
  edit: (charge: FreightCharge) => void;
  openCharge: (id: string) => void;
  openInvoice: (id: string) => void;
  openPayment: (paymentId: string) => void;
  editInvoice: (invoice: CarrierInvoice) => void;
  newInvoice: (carrier: Carrier | null) => void;
  invoiceStep: (invoice: CarrierInvoice, step: string) => Promise<unknown>;
  payInvoice: (invoice: CarrierInvoice) => void;
  voidInvoice: (invoice: CarrierInvoice) => void;
  carrierForm: (carrier: Carrier | null, name?: string) => void;
};
