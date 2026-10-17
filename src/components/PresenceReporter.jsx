import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { startPresence, stopPresence } from '../api/presence';

// Renders nothing: keeps this tab's "online" report running while someone is
// signed in, and ends it on sign-out.
export default function PresenceReporter() {
  const { user } = useAuth();
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return undefined;
    startPresence();
    return stopPresence;
  }, [signedIn]);
  return null;
}
