import React from 'react';
import { AlertCircle } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import CopyButton from './CopyButton';

/**
 * What the admin passes on after Add user (or an Edit user sign-in reset):
 * the username and temporary password to hand over, or confirmation the
 * emailed link went out — and the link itself to copy when the email couldn't
 * be sent.
 *
 *   method   'password' | 'invite'
 *   result   the server's answer: { user, inviteSent, inviteLink }
 *   password the temporary password that was set (method 'password')
 *   reset    true after Edit user (wording), false after Add user
 */
export default function SignInHandover({ method, result, password, reset = false, onClose }) {
    const name = result.user?.name || result.user?.username;
    const invited = method === 'invite';
    return (
        <FormModal title={reset ? 'Sign-in reset' : 'User created'} size="s" onClose={onClose} onSubmit={onClose} submitLabel="Done">
            <div className="up-done">
                <p className="up-done-lead">
                    <strong>{name}</strong>
                    {reset ? '’s changes are saved. ' : '’s account is ready. '}
                    {invited
                        ? (result.inviteSent
                            ? <>We emailed a link to <strong>{result.user?.email}</strong>. {reset ? 'Their current password works until they use it.' : 'They’ll choose their password from the link.'}</>
                            : null)
                        : `Give them this temporary password — they’ll choose their own the ${reset ? 'next' : 'first'} time they sign in.`}
                </p>
                {invited && !result.inviteSent && (
                    <div className="up-warn" role="alert">
                        <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--fm-err-bd)', flex: 'none', marginTop: 1 }} />
                        <span>The email couldn’t be sent. Copy the link below and send it to them yourself — it works once and expires in 7 days.</span>
                    </div>
                )}
                <dl className="up-kv">
                    <dt>Username</dt>
                    <dd className="fm-input-mono">{result.user?.username}</dd>
                    {!invited && (
                        <>
                            <dt>Temporary password</dt>
                            <dd><div className="fm-inline"><span className="fm-input-mono" style={{ flex: 1 }}>{password}</span><CopyButton text={`Username: ${result.user?.username}\nTemporary password: ${password}`} /></div></dd>
                        </>
                    )}
                    {invited && result.inviteLink && (
                        <>
                            <dt>Link</dt>
                            <dd><div className="fm-inline"><span style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{result.inviteLink}</span><CopyButton text={result.inviteLink} /></div></dd>
                        </>
                    )}
                </dl>
            </div>
        </FormModal>
    );
}
