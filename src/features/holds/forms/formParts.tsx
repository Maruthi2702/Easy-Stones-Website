import { AlertCircle } from 'lucide-react';

/*
 * The Hold page's forms, on the shared template (FORM_TEMPLATE.md). Each one
 * hands its values to the page, which saves them with the hold's version and
 * closes the form; a refusal comes back here and shows at the top (this
 * banner; useSubmit holds the saving state).
 */

/** Why the server refused the last save, at the top of the form. */
export const ServerError = ({ message }: { message: string }) => (message ? (
  <div className="hl-form-note err" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{message}</span></div>
) : null);
