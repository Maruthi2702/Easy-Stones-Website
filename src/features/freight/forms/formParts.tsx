import { AlertCircle } from 'lucide-react';

/** A server error, shown at the top of a form's body. */
export const ServerError = ({ message }: { message: string }) => (message ? (
  <div className="fr-form-note err" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{message}</span></div>
) : null);
