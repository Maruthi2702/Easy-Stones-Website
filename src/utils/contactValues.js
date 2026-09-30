/**
 * One contact field, sometimes several values: 13 customers' email field holds
 * a comma-joined list ("info@…,karissa@…"), imported that way from SPS. Shown
 * as one string it has no break point, so on a phone it stretched the
 * customer panel past the screen. Split for display, one value per line.
 *
 * Only commas and semicolons separate values — not "/", which also appears
 * inside a single value ("N/A" in the phone field). Display only: case and
 * placeholders are left as stored (see emailKeys in customerMatch.js for the
 * normalised form used for matching).
 */
export const splitContactValues = (value) => [
  ...new Set(
    String(value ?? '')
      .split(/[,;]/)
      .map((v) => v.trim())
      .filter(Boolean)
  )
];
