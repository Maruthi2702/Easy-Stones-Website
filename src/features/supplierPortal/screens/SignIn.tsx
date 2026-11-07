import { useEffect, useRef, useState } from 'react';
import { LANGUAGES, type StringKey } from '../../../utils/supplierI18n';
import { forgot, signIn, type PortalError } from '../portalApi';
import { usePortal } from '../portalContext';

const KNOWN = ['wrongPassword', 'locked', 'loginOff', 'offline'] as const;

/**
 * Sign in (canvas "Supplier phone · Sign in, language"): the languages first,
 * so a supplier reads everything else in theirs; then email and password.
 * "Forgot your password?" emails a reset link (the answer never says whether
 * the email has a login).
 */
export default function SignIn() {
  const { t, lang, setLang, setMe } = usePortal();
  const [mode, setMode] = useState<'in' | 'forgot' | 'sent'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => { emailRef.current?.focus({ preventScroll: true }); }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') {
        const { me } = await signIn(email.trim(), password);
        setMe(me);
      } else {
        await forgot(email.trim());
        setMode('sent');
      }
    } catch (err) {
      const code = (err as PortalError).code;
      setError(t(code === 'signin' ? 'wrongPassword' : (KNOWN as readonly string[]).includes(code) ? code as StringKey : 'serverError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spx-page is-signin">
      <header className="spx-brand">
        <b>EASY STONES</b>
        <span>{t('portal')}</span>
      </header>
      <main className="spx-main">
        <div className="spx-field">
          <span className="spx-label">{t('language')}</span>
          <div className="spx-chips" role="group" aria-label={t('language')}>
            {LANGUAGES.map((l) => (
              <button key={l.code} type="button" lang={l.code} className={`spx-chipbtn${l.code === lang ? ' is-on' : ''}`} aria-pressed={l.code === lang} onClick={() => setLang(l.code)}>{l.name}</button>
            ))}
          </div>
        </div>

        {mode === 'sent' ? (
          <div className="spx-card">
            <h2>{t('forgotTitle')}</h2>
            <p>{t('linkSent')}</p>
            <button type="button" className="spx-btn" onClick={() => setMode('in')}>{t('backToSignIn')}</button>
          </div>
        ) : (
          <form className="spx-form" onSubmit={submit} noValidate>
            <h2>{mode === 'in' ? t('signInTitle') : t('forgotTitle')}</h2>
            {mode === 'forgot' ? <p className="spx-sub">{t('forgotHint')}</p> : null}
            <div className="spx-field">
              <label className="spx-label" htmlFor="spx-email">{t('email')}</label>
              <input ref={emailRef} id="spx-email" className="spx-input no-capitalize" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode === 'in' ? (
              <div className="spx-field">
                <label className="spx-label" htmlFor="spx-pw">{t('password')}</label>
                <input id="spx-pw" className="spx-input no-capitalize" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            ) : null}
            {error ? <div className="spx-error" role="alert">{error}</div> : null}
            <button type="submit" className="spx-btn is-gold" disabled={busy || !email.trim() || (mode === 'in' && !password)}>
              {busy ? (mode === 'in' ? t('signingIn') : t('sending')) : mode === 'in' ? t('signIn') : t('sendLink')}
            </button>
            {mode === 'in' ? (
              <>
                <button type="button" className="spx-link is-block" onClick={() => { setMode('forgot'); setError(''); }}>{t('forgot')}</button>
                <span className="spx-sub">{t('firstTime')}</span>
              </>
            ) : <button type="button" className="spx-link is-block" onClick={() => { setMode('in'); setError(''); }}>{t('backToSignIn')}</button>}
          </form>
        )}
      </main>
    </div>
  );
}
