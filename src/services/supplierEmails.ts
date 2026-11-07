/**
 * The supplier portal's emails. A supplier reads theirs in their login's
 * language (src/utils/supplierI18n.ts); the one to staff (a block offered) is
 * in English. Each resolves to true when it went out and never throws — a
 * failed email never undoes the save that triggered it.
 */
import { sendEmail } from './emailService.ts';
import { t, reasonText, type StringKey } from '../utils/supplierI18n.ts';
import { noteFor, type Note } from '../utils/supplierBlocks.ts';

const esc = (s: unknown = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as '&']));

const shell = (lang: string, body: string, button?: { href: string; label: string }) => `
  <div lang="${esc(lang)}" style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1b1c1f">
    <div style="background:#1b1c1f;color:#f4f3ef;padding:16px 20px;border-radius:12px 12px 0 0">
      <div style="font-weight:800;letter-spacing:.02em">EASY STONES</div>
      <div style="font-size:13px;color:#c9c6bd">${esc(t(lang, 'portal'))}</div>
    </div>
    <div style="border:1px solid #e2e0d9;border-top:0;border-radius:0 0 12px 12px;padding:20px;line-height:1.5">
      ${body}
      ${button ? `<p style="margin:20px 0 4px"><a href="${esc(button.href)}" style="display:inline-block;background:#d4af37;color:#1b1c1f;font-weight:800;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(button.label)}</a></p>` : ''}
    </div>
  </div>`;

async function send(to: string, subject: string, html: string, tag: string) {
  if (!to) return false;
  try {
    const result = await sendEmail({ to, subject, html, defaultSenderName: 'Easy Stones' });
    return (result as { success?: boolean } | undefined)?.success !== false;
  } catch (error) {
    console.error(`[supplier-email] ${tag} failed:`, (error as Error)?.message || error);
    return false;
  }
}

const noteHtml = (lang: string, note: Note | null | undefined) => {
  const shown = noteFor(note, lang);
  if (!shown) return '';
  return `<p style="margin:14px 0 0;padding:12px;border-radius:10px;background:#f4f3ef"><b>${esc(t(lang, 'm_note'))}</b><br>${esc(shown.text)}</p>`;
};

export function sendSupplierLink({ to, name, supplierName, lang, link, reset }: { to: string; name: string; supplierName: string; lang: string; link: string; reset: boolean }) {
  const body = reset
    ? `<p style="margin:0">${esc(t(lang, 'm_resetBody'))}</p>`
    : `<h2 style="margin:0 0 10px;font-size:20px">${esc(t(lang, 'hello', { name }))}</h2><p style="margin:0">${esc(t(lang, 'm_inviteBody', { name: supplierName }))}</p>`;
  const html = shell(lang, `${body}<p style="margin:12px 0 0;font-size:13px;color:#5d6066">${esc(t(lang, 'm_linkNote'))}<br>${esc(link)}</p>`,
    { href: link, label: t(lang, reset ? 'choosePassword' : 'm_invitePw') });
  return send(to, t(lang, reset ? 'm_resetSubject' : 'm_inviteSubject'), html, reset ? 'reset' : 'invite');
}

export function sendPoAssigned({ to, lang, poNumber, lines, link, note }: { to: string; lang: string; poNumber: string; lines: { material: string; slabs: number; thickness?: string }[]; link: string; note: Note | null }) {
  const list = lines.map((l) => `${l.material}${l.thickness ? ` ${l.thickness}` : ''} · ${t(lang, 'slabs', { n: l.slabs })}`).join('; ');
  const html = shell(lang, `<p style="margin:0">${esc(t(lang, 'm_poBody', { po: poNumber, lines: list }))}</p>${noteHtml(lang, note)}`, { href: link, label: t(lang, 'm_open') });
  return send(to, t(lang, 'm_poSubject', { po: poNumber }), html, 'po assigned');
}

type DecidedBundle = { n: number; status: string; decision?: string; reason?: string; comment?: Note | null; photoUrl?: string };

const thumb = (url?: string) => (url && /^https:\/\//.test(url) ? `<td style="padding:6px 10px 6px 0;vertical-align:top"><img src="${esc(url)}" alt="" width="96" style="display:block;width:96px;height:72px;object-fit:cover;border-radius:6px"></td>` : '');

/**
 * After a step's decisions: what happened to each bundle decided, in the
 * supplier's words. With no `link` (a supplier with no portal login, whose
 * blocks purchasing enters for them) each bundle shows its photo instead.
 */
export function sendDecisions({ to, lang, blockNumber, poNumber, bundles, note, link }: { to: string; lang: string; blockNumber: string; poNumber: string; bundles: DecidedBundle[]; note: Note | null; link?: string }) {
  const finalOnly = bundles.every((b) => b.status === 'approved');
  const rows = bundles.map((b) => {
    const why = b.status === 'rejected' || b.status === 'retake' ? reasonText(lang, b.status === 'retake' ? 'retake' : 'reject', b.reason) : '';
    const comment = noteFor(b.comment, lang)?.text || '';
    const colour = b.status === 'approved' ? '#17663a' : b.status === 'final' ? '#6f560b' : b.status === 'rejected' ? '#9a3d06' : '#1d4f91';
    return `<tr>${link ? '' : thumb(b.photoUrl)}<td style="padding:6px 10px 6px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(t(lang, 'bundle', { n: b.n }))}</td>
      <td style="padding:6px 0;color:${colour};font-weight:600">${esc(t(lang, `st_${b.status}` as StringKey))}${why ? ` · ${esc(why)}` : ''}${comment ? `<div style="color:#3a3c41;font-weight:400">${esc(comment)}</div>` : ''}</td></tr>`;
  }).join('');
  const html = shell(lang, `<p style="margin:0 0 10px">${esc(t(lang, 'm_decisionIntro', { block: blockNumber, po: poNumber }))}</p>
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>${noteHtml(lang, note)}
    <p style="margin:14px 0 0;font-size:13px;color:#5d6066">${esc(t(lang, 'lockNote'))}</p>`, link ? { href: link, label: t(lang, 'm_open') } : undefined);
  return send(to, t(lang, finalOnly ? 'm_finalSubject' : 'm_decisionSubject', { block: blockNumber, po: poNumber }), html, 'decisions');
}

export function sendUnlocked({ to, lang, blockNumber, poNumber, list, reason, link }: { to: string; lang: string; blockNumber: string; poNumber: string; list: string; reason: Note | null; link?: string }) {
  const html = shell(lang, `<p style="margin:0">${esc(t(lang, 'm_unlockBody', { list, block: blockNumber }))}</p>${noteHtml(lang, reason)}`, link ? { href: link, label: t(lang, 'm_open') } : undefined);
  return send(to, t(lang, 'm_unlockSubject', { block: blockNumber, po: poNumber }), html, 'unlocked');
}

/** To the PO's buyer when a supplier sends a block (or changes) for review — or someone in purchasing enters it for them (`enteredBy`). */
export function sendBlockOffered({ to, buyerName, supplierName, poNumber, blockNumber, material, bundles, slabs, link, resent, enteredBy }: { to: string; buyerName: string; supplierName: string; poNumber: string; blockNumber: string; material: string; bundles: number; slabs: number; link: string; resent: boolean; enteredBy?: string }) {
  const html = shell('en', `<p style="margin:0">Hi ${esc(buyerName || 'there')},</p>
    <p style="margin:10px 0 0">${enteredBy ? `${esc(enteredBy)} ${resent ? 'entered changes to' : 'entered'}` : `${esc(supplierName)} ${resent ? 'sent changes to' : 'offered'}`} <b>block ${esc(blockNumber)}</b>${enteredBy ? ` for ${esc(supplierName)}` : ''} on PO ${esc(poNumber)} — ${esc(material)}: ${bundles} bundle${bundles === 1 ? '' : 's'}, ${slabs} slabs, waiting for review.</p>`,
  { href: link, label: 'Review the block' });
  return send(to, `PO ${poNumber}: block ${blockNumber} ${resent ? 'changed' : 'offered'} by ${supplierName}${enteredBy ? ` (entered by ${enteredBy})` : ''}`, html, 'block offered');
}
