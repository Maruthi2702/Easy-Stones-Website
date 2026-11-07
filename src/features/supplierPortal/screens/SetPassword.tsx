import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PASSWORD_MIN } from '../../../utils/supplierBlocks';
import { acceptLink, checkLink, type PortalError } from '../portalApi';
import { usePortal } from '../portalContext';
import { Loading } from '../components';

/**
 * The invite / reset link (/supplier/set-password?token=…): choose a password
 * and you're signed in. The link works once, for 7 days; it opens in the
 * login's language.
 */
export default function SetPassword() {
  const { t, setLang, setMe } = usePortal();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'ok' | 'bad'>('checking');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    checkLink(token).then((r) => { if (!live) return; setName(r.name); setLang(r.language); setState('ok'); })
      .catch(() => { if (live) setState('bad'); });
    return () => { live = false; };
  }, [token, setLang]);

  const short = pw.length < PASSWORD_MIN;
  const mismatch = pw !== again;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (short || mismatch) return;
    setBusy(true);
    setError('');
    try {
      const { me } = await acceptLink(token, pw);
      setMe(me);
      navigate('/supplier', { replace: true });
    } catch (err) {
      const code = (err as PortalError).code;
      if (code === 'linkBad') setState('bad'); else setError(t(code === 'offline' ? 'offline' : 'serverError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spx-page is-signin">
      <header className="spx-brand"><b>EASY STONES</b><span>{t('portal')}</span></header>
      <main className="spx-main">
        {state === 'checking' ? <Loading /> : state === 'bad' ? (
          <div className="spx-card">
            <p>{t('linkBad')}</p>
            <button type="button" className="spx-btn" onClick={() => navigate('/supplier', { replace: true })}>{t('backToSignIn')}</button>
          </div>
        ) : (
          <form className="spx-form" onSubmit={submit} noValidate>
            <h2>{t('hello', { name })}</h2>
            <p className="spx-sub">{t('choosePassword')}</p>
            <div className="spx-field">
              <label className="spx-label" htmlFor="spx-npw">{t('newPassword')}</label>
              <input id="spx-npw" className={`spx-input no-capitalize${submitted && short ? ' is-error' : ''}`} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <span className={`spx-sub${submitted && short ? ' is-error' : ''}`}>{t('passwordShort')}</span>
            </div>
            <div className="spx-field">
              <label className="spx-label" htmlFor="spx-npw2">{t('passwordAgain')}</label>
              <input id="spx-npw2" className={`spx-input no-capitalize${submitted && mismatch ? ' is-error' : ''}`} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
              {submitted && mismatch && !short ? <span className="spx-sub is-error">{t('passwordMismatch')}</span> : null}
            </div>
            {error ? <div className="spx-error" role="alert">{error}</div> : null}
            <button type="submit" className="spx-btn is-gold" disabled={busy}>{busy ? t('sending') : t('saveAndSignIn')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
