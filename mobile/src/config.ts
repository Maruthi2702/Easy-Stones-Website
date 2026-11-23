/**
 * The site the app shows. The same address the Capacitor app loaded: the staff and supplier sign-in cookies are first-party
 * there. Set EXPO_PUBLIC_SERVER_URL to point a build at a preview.
 */
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || 'https://easystones.onrender.com').replace(/\/+$/, '');
export const SERVER_HOST = new URL(SERVER_URL).host;
export const HOME_PATH = '/sales';
