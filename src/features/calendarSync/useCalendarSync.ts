import { useEffect, useState } from 'react';
import { viewerTimeZone } from '../../utils/dateUtils';
import {
  fetchGoogleStatus, fetchICloudStatus, googleLinkUrl, syncGoogle, disconnectGoogle,
  connectICloud, syncICloud, disconnectICloud, readBody,
  type GoogleSyncStatus, type ICloudSyncStatus, type ICloudCalendar
} from './calendarSyncApi';

/**
 * Calendar sync's state and actions (Google two-way, iCloud two-way). Held by
 * the page rather than the modal, so what someone typed into the iCloud form
 * is still there when they reopen it — as before the move. `open` loads both
 * statuses each time the modal opens; `onSynced` runs after a sync or a new
 * link, for the page to reload its schedule.
 */
export function useCalendarSync({ open, onSynced }: { open: boolean; onSynced?: () => void }) {
  const [googleStatus, setGoogleStatus] = useState<GoogleSyncStatus>({ connected: false, email: '' });
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  const [icloudStatus, setIcloudStatus] = useState<ICloudSyncStatus>({ connected: false, email: '', calendarName: '' });
  const [isSyncingICloud, setIsSyncingICloud] = useState(false);
  const [isConnectingICloud, setIsConnectingICloud] = useState(false);
  const [appleId, setAppleId] = useState('');
  const [appSpecificPassword, setAppSpecificPassword] = useState('');
  const [calendars, setCalendars] = useState<ICloudCalendar[]>([]);
  const [selectedCalendarUrl, setSelectedCalendarUrl] = useState('');
  const [icloudError, setIcloudError] = useState('');

  const loadGoogleStatus = async () => {
    try {
      const res = await fetchGoogleStatus();
      if (res.ok) setGoogleStatus(await res.json());
    } catch (err) {
      console.error('Error fetching Google Sync status:', err);
    }
  };

  const loadICloudStatus = async () => {
    try {
      const res = await fetchICloudStatus();
      if (res.ok) setIcloudStatus(await res.json());
    } catch (err) {
      console.error('Error fetching iCloud status:', err);
    }
  };

  const linkGoogle = () => {
    window.location.href = googleLinkUrl();
  };

  const syncGoogleNow = async () => {
    try {
      setIsSyncingGoogle(true);
      const res = await syncGoogle(viewerTimeZone);
      if (res.ok) {
        alert('Synchronization completed successfully!');
        onSynced?.();
      } else {
        alert('Failed to sync Google Calendar.');
      }
    } catch (err) {
      console.error('Sync error:', err);
      alert('Network error during synchronization.');
    } finally {
      setIsSyncingGoogle(false);
    }
  };

  const unlinkGoogle = async () => {
    if (!window.confirm('Are you sure you want to disconnect Google Calendar? This will stop event syncing.')) return;
    try {
      const res = await disconnectGoogle();
      if (res.ok) {
        setGoogleStatus({ connected: false, email: '' });
        alert('Google Calendar disconnected.');
      }
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  /** Step 1: check the Apple ID and list its writeable calendars. */
  const findICloudCalendars = async (e?: { preventDefault: () => void }) => {
    if (e) e.preventDefault();
    if (!appleId || !appSpecificPassword) {
      setIcloudError('Apple ID and App-Specific Password are required.');
      return;
    }
    setIsConnectingICloud(true);
    setIcloudError('');
    try {
      const res = await connectICloud({ appleId, appSpecificPassword });
      const data = await readBody(res);
      if (res.ok) {
        if (data.calendars && data.calendars.length > 0) {
          setCalendars(data.calendars);
          setSelectedCalendarUrl(data.calendars[0].url);
        } else {
          setIcloudError('No writeable calendars found on this iCloud account.');
        }
      } else {
        setIcloudError(data.message || 'Failed to authenticate with iCloud.');
      }
    } catch (err) {
      console.error('iCloud discovery error:', err);
      setIcloudError(`Connection error: ${(err as Error).message || 'Failed to communicate with backend'}`);
    } finally {
      setIsConnectingICloud(false);
    }
  };

  /** Step 2: link the chosen calendar (which also runs its first sync, server-side). */
  const linkICloudCalendar = async () => {
    const selectedCal = calendars.find((c) => c.url === selectedCalendarUrl);
    if (!selectedCal) return;
    setIsConnectingICloud(true);
    setIcloudError('');
    try {
      const res = await connectICloud({
        appleId,
        appSpecificPassword,
        calendarUrl: selectedCal.url,
        calendarName: selectedCal.name,
        tz: viewerTimeZone
      });
      const data = await readBody(res);
      if (res.ok) {
        setIcloudStatus({ connected: true, email: appleId, calendarName: data.calendarName as string });
        setCalendars([]);
        setAppleId('');
        setAppSpecificPassword('');
        alert('iCloud Calendar linked successfully!');
        onSynced?.();
      } else {
        setIcloudError(data.message || 'Failed to save calendar configuration.');
      }
    } catch (err) {
      console.error('iCloud save error:', err);
      setIcloudError(`Connection error: ${(err as Error).message || 'Failed to communicate with backend'}`);
    } finally {
      setIsConnectingICloud(false);
    }
  };

  const syncICloudNow = async () => {
    try {
      setIsSyncingICloud(true);
      const res = await syncICloud(viewerTimeZone);
      if (res.ok) {
        alert('iCloud Calendar synchronized successfully!');
        onSynced?.();
      } else {
        alert('Failed to sync iCloud Calendar.');
      }
    } catch (err) {
      console.error('iCloud sync error:', err);
      alert('Network error during synchronization.');
    } finally {
      setIsSyncingICloud(false);
    }
  };

  const unlinkICloud = async () => {
    if (!window.confirm('Are you sure you want to disconnect iCloud Calendar? Your iPhone events will no longer sync.')) return;
    try {
      const res = await disconnectICloud();
      if (res.ok) {
        setIcloudStatus({ connected: false, email: '', calendarName: '' });
        alert('iCloud Calendar disconnected.');
      }
    } catch (err) {
      console.error('iCloud disconnect error:', err);
    }
  };

  useEffect(() => {
    if (open) {
      loadGoogleStatus();
      loadICloudStatus();
    }
  }, [open]);

  // Back from Google's sign-in: say so, clean the address bar, refresh the status.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_sync') === 'success') {
      alert('Google Calendar connected successfully!');
      window.history.replaceState({}, document.title, window.location.pathname);
      loadGoogleStatus();
    }
  }, []);

  return {
    google: { status: googleStatus, syncing: isSyncingGoogle, link: linkGoogle, sync: syncGoogleNow, unlink: unlinkGoogle },
    icloud: {
      status: icloudStatus,
      syncing: isSyncingICloud,
      connecting: isConnectingICloud,
      appleId, setAppleId,
      appSpecificPassword, setAppSpecificPassword,
      calendars, selectedCalendarUrl, setSelectedCalendarUrl,
      error: icloudError,
      findCalendars: findICloudCalendars,
      linkCalendar: linkICloudCalendar,
      sync: syncICloudNow,
      unlink: unlinkICloud
    }
  };
}

export type CalendarSync = ReturnType<typeof useCalendarSync>;
