import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { pathForLink } from '../../utils/appLinks';

/**
 * Universal links in the iOS app: a tapped link to the site (an invite email, a
 * supplier link) opens the app and goes to that page. Which links are ours is
 * `APP_LINK_PATHS`, the same list the server publishes to Apple. Draws nothing,
 * and does nothing in a browser.
 */
export default function NativeLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('appUrlOpen', ({ url }) => {
      const path = pathForLink(url, [window.location.host]);
      if (path) navigate(path);
    });
    return () => { void handle.then(h => h.remove()); };
  }, [navigate]);
  return null;
}
