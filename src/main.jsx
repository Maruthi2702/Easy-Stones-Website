import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// ── Pick up new deploys ──────────────────────────────────────────────────────
// The service worker precaches index.html and every JS chunk, so a tab that has
// been open (or a browser that hasn't re-fetched sw.js) keeps running the build
// it first loaded — which looks like a deployed fix simply not being there.
// registerSW.js installs the update but never reloads the page, so:
//   1. check for a new worker periodically, not only on a cold navigation, and
//   2. reload once the new one takes over, so the fresh chunks are actually used.
if ('serviceWorker' in navigator) {
  // True only when a worker was already controlling this page. On a first visit
  // clientsClaim() also fires controllerchange, and reloading there would be a
  // pointless (and, if it ever loops, harmful) refresh.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.ready.then(registration => {
    setInterval(() => registration.update().catch(() => {}), 15 * 60 * 1000);
  }).catch(() => {});
}


