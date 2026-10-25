import { useState } from 'react';

/**
 * The QR / NFC modal's choices — branch, domain, "Copied!" — held by the
 * panel so they're still set when the modal reopens. Starts on the branch
 * the log is filtered to.
 */
export function useQrCodes(filterLocation: string | null) {
  const [location, setLocation] = useState(filterLocation || 'Seattle');
  const [copied, setCopied] = useState(false);
  const [domain, setDomain] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));
  return { location, setLocation, copied, setCopied, domain, setDomain };
}

