// The freight forms' small shared rules.

/** A YYYY-MM-DD date, as the calendar gives it. */
export const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The first field, in the form's order, that has an error (the one to move to). */
export const firstError = (errors: Record<string, string>, order: string[]) => order.find((k) => errors[k]);
