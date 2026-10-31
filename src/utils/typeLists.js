/*
 * Rules for the two admin-managed lists, Visit Types and Resource Types
 * (src/routes/typeLists.js, src/features/types/). Shared by the server and the
 * screens. The lists themselves live in the database — nothing here names a
 * type.
 */

export const FOLLOW_UP_MODES = ['none', 'optional', 'always'];
export const RESOURCE_FAMILIES = ['tower', 'tabletop', 'binder', 'samples', 'other'];
export const NAME_MAX = 120;

/** What a type with no settings (a legacy value on an old visit) uses: everything, follow-up behind a toggle. */
export const DEFAULT_VISIT_FIELDS = Object.freeze({ notes: true, outcome: true, followUp: 'optional' });

/** A visit type's fields, cleaned: booleans, a known follow-up mode. */
export const normalizeVisitFields = (fields) => {
  const f = fields && typeof fields === 'object' ? fields : {};
  return {
    notes: f.notes === undefined ? DEFAULT_VISIT_FIELDS.notes : Boolean(f.notes),
    outcome: f.outcome === undefined ? DEFAULT_VISIT_FIELDS.outcome : Boolean(f.outcome),
    followUp: FOLLOW_UP_MODES.includes(f.followUp) ? f.followUp : DEFAULT_VISIT_FIELDS.followUp
  };
};

/** The key two names are compared by: case and extra spaces don't make a new type. */
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The types the Add dropdown offers: active ones, in order. */
export const activeTypes = (types = []) =>
  [...types].filter((t) => t && t.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/**
 * What an Add / Edit body may carry. `kind` is 'visit' or 'resource'. Returns
 * `{ error }` or `{ value }` (only the keys that were sent, cleaned).
 * `others` are the other types, for the duplicate check.
 */
export const validateTypeBody = (kind, body = {}, others = []) => {
  const value = {};
  if (body.name !== undefined || body.label !== undefined) {
    const label = String(body.label ?? body.name ?? '').trim().replace(/\s+/g, ' ');
    if (!label) return { error: 'Enter a name.' };
    if (label.length > NAME_MAX) return { error: `A name can be at most ${NAME_MAX} characters.` };
    if (others.some((o) => nameKey(o.name) === nameKey(label) || nameKey(o.label) === nameKey(label))) {
      return { error: 'There is already a type with that name.' };
    }
    value.label = label;
  }
  if (body.active !== undefined) value.active = Boolean(body.active);
  if (kind === 'visit' && body.fields !== undefined) value.fields = normalizeVisitFields(body.fields);
  if (kind === 'resource' && body.family !== undefined) {
    if (!RESOURCE_FAMILIES.includes(body.family)) return { error: 'Choose a family.' };
    value.family = body.family;
  }
  return { value };
};

/** The new order, from the ids sent: every current id exactly once, or null. */
export const reorderedIds = (currentIds, sentIds) => {
  if (!Array.isArray(sentIds)) return null;
  const sent = sentIds.map(String);
  const current = currentIds.map(String);
  if (sent.length !== current.length || new Set(sent).size !== sent.length) return null;
  return current.every((id) => sent.includes(id)) ? sent : null;
};

/** Move the item at `from` to `to`, returning a new array (the Move to top / ↑↓ / drop rule). */
export const moveItem = (list, from, to) => {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
};

/** Visit form rules for one type record (undefined = a legacy value): which parts show. */
export const visitFieldsOf = (type) => normalizeVisitFields(type?.fields);
