/**
 * What actually gets PUT to the server for a Daily Work Report save.
 *
 * Pulled out of DailyReportTab as its own pure module so the rule can be unit
 * tested without a DOM: an incident (2026-08-28) shipped a version of this
 * that stripped untouched auto figures on *every* save, including the one
 * immediately before submitting — since /submit never re-derives, that
 * permanently wiped Deliveries/Pick-ups slabs and transfer lines off of
 * several already-submitted reports the moment they were signed off. See
 * savePayload.test.js for the regression coverage.
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
 * The single decision point for what a save actually sends.
 *
 * `freeze: true` is for the save that immediately precedes submitting —
 * /submit locks in whatever this PUT just stored and never re-derives again,
 * so that save has to carry the real, currently-displayed figures verbatim
 * rather than the blanked-out draft version. Everything else goes through
 * buildDraftPayload so untouched figures stay live.
 */
export const buildSaveBody = (report, { touchedCapacity, touchedTransferSlabs, freeze = false }) =>
  freeze ? report : buildDraftPayload(report, touchedCapacity, touchedTransferSlabs);
