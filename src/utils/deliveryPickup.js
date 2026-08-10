/**
 * One definition of "this order is collected, not delivered".
 *
 * A pickup is an order nobody of ours drives to a jobsite: the customer comes
 * for it themselves (a will call), or a contract carrier does. Both are signed
 * for over the counter by whoever turns up, which is why the office board
 * carries their ePOD action and the driver app does not — there is no driver to
 * hand the signature pad to.
 *
 * The board, the ePOD modal and the server's certificate stamping all import
 * from here. They have to agree: a ticket the board offers to sign must be one
 * the certificate labels as collected.
 */

export const THIRD_PARTY_TRUCK_ID = 'trk_3rd_party';

/**
 * The contract-freight column may be the built-in DEFAULT_TRUCKS row or, once
 * real driver accounts exist, a user whose name spells it out
 * ("3rd party - delivery"). Match either.
 */
export const THIRD_PARTY_NAME = /3rd\s*[-–—\s]*party|third\s*[-–—\s]*party/i;

export const isThirdPartyTruck = (trk) => Boolean(
  trk && (
    trk.id === THIRD_PARTY_TRUCK_ID ||
    THIRD_PARTY_NAME.test(`${trk.driver || ''} ${trk.name || ''} ${trk.username || ''}`)
  )
);

export const isWillCall = (delivery) => delivery?.deliveryType === 'will_call';

/**
 * Is this order collected rather than delivered? Needs the truck list, because
 * a will call announces itself on the delivery while contract freight is only
 * knowable from the column the ticket sits in.
 */
export const isPickupDelivery = (delivery, trucks = []) =>
  isWillCall(delivery) ||
  isThirdPartyTruck((trucks || []).find(t => t.id === delivery?.truckId));

/**
 * Wording for whichever kind of ticket is being signed.
 *
 * The form fields are deliberately identical for both. Staff fill in one form
 * whether the material is going out on a truck or over the counter, and giving
 * the same boxes two sets of names made a familiar screen read as an unfamiliar
 * one. Only what frames the form changes — the title says which kind of ticket
 * this is, and the pickup carries the carrier and vehicle it is checked against.
 *
 * The stamped certificate is the exception, and stays worded for what happened:
 * a PDF asserting that a driver signed for material the customer carried out in
 * their own truck is a document that says something untrue. Nobody reads the
 * certificate to find a field, so nothing is gained there by matching the form.
 */
export const PICKUP_WORDING = {
  title: 'Proof of Collection (ePOD)',
  reference: 'Pickup',
  signeeLabel: 'Customer Signee Full Name',
  signeePlaceholder: 'e.g. Marcus Johnson',
  customerSigLabel: 'Customer Signature',
  driverSigLabel: 'Driver Signature',
  driverHint: 'Driver sign-off confirmation',
  customerHint: 'Sign above using touchscreen finger or stylus',
  photosLabel: 'Delivered Slab Inspection Photos',
  submitLabel: 'Complete Pickup & Sign PDF',
  notesLabel: 'Delivery Completion Notes',
  viewerTitle: 'Proof of Collection',
  viewerPhotosLabel: 'Delivered Slab Photos',
  viewerEmpty: 'No ePOD has been signed for this pickup yet.',
  viewerEmptyHint: 'The counter captures it from the board, with Release & Sign on the ticket.',
  missingSignee: 'signee name',
  missingCustomerSig: 'customer signature',
  missingDriverSig: 'driver signature',
  errorSignee: 'Please enter the customer signee name.',
  errorCustomerSig: 'Customer signature is required.',
  errorDriverSig: 'Driver signature is required.',
  certificateTitle: 'PROOF OF COLLECTION (ePOD) DIGITAL SIGNATURE CERTIFICATE',
  certCustomerLabel: 'COLLECTED BY',
  certDriverLabel: 'RELEASED BY',
  certSigneeRole: 'Collected by',
  certDriverRole: 'Released by'
};

export const DELIVERY_WORDING = {
  title: 'Electronic Proof of Delivery (ePOD)',
  reference: 'Delivery',
  signeeLabel: 'Customer Signee Full Name',
  signeePlaceholder: 'e.g. Marcus Johnson',
  customerSigLabel: 'Customer Signature',
  driverSigLabel: 'Driver Signature',
  driverHint: 'Driver sign-off confirmation',
  customerHint: 'Sign above using touchscreen finger or stylus',
  photosLabel: 'Delivered Slab Inspection Photos',
  submitLabel: 'Complete Delivery & Sign PDF',
  notesLabel: 'Delivery Completion Notes',
  viewerTitle: 'Proof of Delivery',
  viewerPhotosLabel: 'Delivered Slab Photos',
  viewerEmpty: 'No ePOD has been signed for this delivery yet.',
  viewerEmptyHint: 'The driver needs to complete the Delivered / Sign ePOD step.',
  missingSignee: 'signee name',
  missingCustomerSig: 'customer signature',
  missingDriverSig: 'driver signature',
  errorSignee: 'Please enter the customer signee name.',
  errorCustomerSig: 'Customer signature is required.',
  errorDriverSig: 'Driver signature is required.',
  certificateTitle: 'PROOF OF DELIVERY (ePOD) DIGITAL SIGNATURE CERTIFICATE',
  certCustomerLabel: 'CUSTOMER SIGNATURE',
  certDriverLabel: 'DRIVER SIGNATURE',
  certSigneeRole: 'Signee',
  certDriverRole: 'Driver'
};

export const wordingFor = (isPickup) => (isPickup ? PICKUP_WORDING : DELIVERY_WORDING);
