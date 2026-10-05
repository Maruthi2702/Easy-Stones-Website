/**
 * What actually gets PUT to the server for a Daily Work Report save.
 *
 * Pulled out of DailyReportTab as its own pure module so the rule can be unit
 * tested without a DOM: an incident (2026-08-28) shipped a version of this
 * that stripped untouched auto figures on *every* save, including the one
 * immediately before submitting — and since /submit didn't re-derive back
 * then, that permanently wiped Deliveries/Pick-ups slabs and transfer lines
 * off of several already-submitted reports the moment they were signed off.
 *
 * The first fix sent the page's figures verbatim ("freeze") for that last
 * save. That stopped the wipe but locked in whatever the page had loaded, so
 * a sheet opened in the morning signed off the morning's check-ins. Since
 * 2026-10-05 /submit re-derives itself (applyDerived, same as the 11:59
 * auto-submit), so every save — the one before Submit included — is a draft
 * save, and the blanks it leaves are filled with the figures as of the
 * submit. See savePayload.test.js and applyDerived's tests.
 */

/**
 * Strips the derived-but-never-typed figures back out of a draft save.
 *
 * `report` already has capacity and auto transfer slabs filled in by the
 * server's last derive, so they display correctly — but that fill-in isn't a
 * human saying "this is right," and saving it verbatim would tell the server
 * otherwise. Blanking anything the user hasn't actually touched keeps those
 * figures live (re-derived from the schedule/tickets on every load) until
 * someone hand-corrects them, instead of freezing at whatever they were the
 * moment an unrelated field on the same report got edited.
 */
export const buildDraftPayload = (report, touchedCapacity, touchedTransferSlabs) => {
  const body = structuredClone(report);
  if (!touchedCapacity.has('deliveries')) body.deliveries.capacity = null;
  if (!touchedCapacity.has('pickups')) body.pickups.capacity = null;
  body.transfers = body.transfers.filter(t => {
    if (!t.auto) return true;
    return touchedTransferSlabs.has(`${t.direction || 'out'}:${t.fromTo}`);
  });
  return body;
};

/**
 * The single decision point for what a save actually sends: always the draft
 * body, so untouched figures stay live. Safe for the save right before Submit
 * only because POST /submit re-derives before locking — if that ever stops
 * being true, the 2026-08-28 incident comes straight back.
 */
export const buildSaveBody = (report, { touchedCapacity, touchedTransferSlabs }) =>
  buildDraftPayload(report, touchedCapacity, touchedTransferSlabs);
