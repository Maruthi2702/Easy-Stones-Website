import { useCallback, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { getMe } from './portalApi';
import { PortalProvider } from './PortalProvider';
import { usePortal } from './portalContext';
import { Loading } from './components';
import SignIn from './screens/SignIn';
import SetPassword from './screens/SetPassword';
import Home from './screens/Home';
import PoScreen from './screens/PoScreen';
import BlockScreen from './screens/BlockScreen';
import './SupplierPortal.css';

/**
 * The supplier portal (/supplier, 2026-11-07) — the supplier's side of
 * Supplier POs, made for a phone in a stone yard: light, big buttons, one
 * photo per bundle uploading as it's taken, in the supplier's language.
 * Design: the claude.ai artifact "Supplier Portal Design" (the Supplier phone
 * row). Its own sign-in (src/services/supplierSession.ts); staff screens and
 * the staff session are never touched from here.
 *
 *   /supplier                     My POs (or Sign in)
 *   /supplier/po/:id              one PO
 *   /supplier/block/:id           offer / change / see a block
 *   /supplier/set-password?token  the invite or reset link
 */
export default function SupplierPortal() {
  return (
    <PortalProvider>
      <PortalRoutes />
    </PortalProvider>
  );
}

function PortalRoutes() {
  const { me, setMe, lang, t } = usePortal();
  const [checked, setChecked] = useState(false);
  const location = useLocation();
  const linkPage = location.pathname.startsWith('/supplier/set-password');

  useEffect(() => {
    if (linkPage) { setChecked(true); return; }
    let live = true;
    getMe().then((r) => { if (live) setMe(r.me); }).catch(() => { if (live) setMe(null); }).finally(() => { if (live) setChecked(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `Easy Stones · ${t('portal')}`;
  }, [lang, t]);
  useEffect(() => {
    document.body.classList.add('supplier-portal');
    return () => document.body.classList.remove('supplier-portal');
  }, []);
  const signedOut = useCallback(() => setMe(null), [setMe]);

  if (linkPage) return <Routes><Route path="set-password" element={<SetPassword />} /></Routes>;
  if (!checked) return <div className="spx-page"><Loading /></div>;
  if (!me) return <SignIn />;
  return (
    <Routes>
      <Route index element={<Home onSignedOut={signedOut} />} />
      <Route path="po/:id" element={<PoScreen onSignedOut={signedOut} />} />
      <Route path="block/:id" element={<BlockScreen onSignedOut={signedOut} />} />
      <Route path="*" element={<Home onSignedOut={signedOut} />} />
    </Routes>
  );
}
