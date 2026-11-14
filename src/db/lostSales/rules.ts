/** The checks Mongoose's LostSale schema makes on a save, for the Postgres side to repeat (keep in step with src/models/LostSale.ts). */
export const REASONS: readonly string[] = ['Out of Stock', 'Price Too High', 'Lead Time', 'Color / Pattern Match', 'Quality / Spec Issue', 'Competitor Discount', 'Customer Cancelled', 'Other'];

/** An error worded as Mongoose's, so the route's 500 answers the same on either database. */
export const validationError = (problems: string[], onUpdate = false) => {
  const error = new Error(`${onUpdate ? 'Validation' : 'LostSale validation'} failed: ${problems.join(', ')}`);
  error.name = 'ValidationError';
  return error;
};
