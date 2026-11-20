/**
 * Sets up company cards (Credit Card Receipts) from a tab-separated list of card holders:
 *   the sheet's rows (Sl.No, ID, Location, Name, Card ID, Mail) pasted as they are, or just
 *   Location <TAB> Name <TAB> Card ID (e.g. MARU92069) <TAB> Email
 * The list is never kept in the repo (it's public): give the file as the argument.
 *
 *   node scripts/card-holders-setup.ts holders.tsv            dry run: who matches, nothing written
 *   node scripts/card-holders-setup.ts holders.tsv --apply    creates the cards that matched
 *
 * Each holder is matched to a staff login by email, else by exactly one login with the same name
 * (case and spacing ignored). A holder who matches no one, or two logins, is listed and skipped.
 * A person who already has an active card, or a card ID / digits already in use, is skipped and
 * said so. The card's last digits are the ID's last 5 (what Amex's "Account #" ends in).
 * Needs DATABASE_URL (Render shell). Safe to run twice.
 */
import fs from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { openDb } from '../src/db/client.ts';
import { users, locations } from '../src/db/schema/reference.ts';
import { companyCards } from '../src/db/schema/cardsSuppliers.ts';
import { addCard } from '../src/db/cardReceipts/postgres.ts';
import { cleanCard } from '../src/utils/cardReceipts.ts';
import { newId } from '../src/db/ids.ts';
import type { Db } from '../src/db/copy/plan.ts';

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!file || !url) { console.error('Usage: DATABASE_URL=… node scripts/card-holders-setup.ts holders.tsv [--apply]'); process.exit(1); }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
// Rows as the sheet has them (Sl.No, ID, Location, Name, Card ID, Mail …) or just Location, Name, Card ID, Email:
// the Card ID is the cell like MARU92069, the name and location sit before it, the email after.
// Rows marked Left or Inactive Card (and the "Left" list) are skipped.
const isLabel = (c: string) => /^[A-Za-z]{3,6}\d{5}$/.test(c);
const holders = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.split('\t').map(c => c.trim()))
  .filter(r => !r.some(c => /^(left|inactive card)$/i.test(c)))
  .flatMap(r => {
    const i = r.findIndex(isLabel);
    if (i < 2 || !r[i - 1]) return [];
    return [{ location: r[i - 2]!, name: r[i - 1]!, label: r[i]!.toUpperCase(), emails: String(r[i + 1] || '').split('/').map(e => e.trim().toLowerCase()).filter(e => e.includes('@')) }];
  });

// An email on several holders (an office mailbox) says nothing about who is who: only the name decides then.
const mailCount = new Map<string, number>();
for (const h of holders) for (const e of new Set(h.emails)) mailCount.set(e, (mailCount.get(e) || 0) + 1);

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const people = await d.select({ id: users.id, name: users.displayName, username: users.username, email: users.email, active: users.isActive, home: locations.name })
    .from(users).leftJoin(locations, eq(locations.id, users.homeLocationId));
  const cards = await d.select().from(companyCards).where(eq(companyCards.active, true));
  const haveUser = new Map(cards.map(c => [c.userId, c.label]));
  const usedLabel = new Set(cards.map(c => c.label));
  const usedDigits = new Map(cards.map(c => [c.lastDigits, c.label]));
  const tally = { made: 0, had: 0, none: 0, many: 0, clash: 0 };
  for (const h of holders) {
    const digits = h.label.slice(-5);
    const own = h.emails.filter(e => mailCount.get(e) === 1);
    const byMail = people.filter(p => p.email && own.includes(p.email.toLowerCase()) && p.username !== 'admin');
    const byName = people.filter(p => norm(p.name) === norm(h.name) && p.username !== 'admin');
    const found = byMail.length === 1 ? byMail : byName.length ? byName : byMail;
    const tag = `${h.label.padEnd(10)} ${h.name} (${h.location})`;
    if (found.length === 0) { tally.none += 1; console.log(`✗ NO LOGIN      ${tag} — no staff login with that email or name`); continue; }
    if (found.length > 1) { tally.many += 1; console.log(`✗ SEVERAL       ${tag} — ${found.map(p => `${p.name} <${p.email}>`).join('; ')}`); continue; }
    const p = found[0]!;
    const how = byMail.length === 1 && byMail[0] === p ? 'email' : 'name';
    if (haveUser.has(p.id)) { tally.had += 1; console.log(`= HAS A CARD    ${tag} — already ${haveUser.get(p.id)}`); continue; }
    if (usedLabel.has(h.label) || usedDigits.has(digits)) { tally.clash += 1; console.log(`✗ CARD IN USE   ${tag} — ${usedDigits.get(digits) || h.label} is another person's`); continue; }
    const checked = cleanCard({ userId: p.id, issuer: 'amex', lastDigits: digits, label: h.label });
    if (!checked.value) { tally.clash += 1; console.log(`✗ BAD CARD      ${tag} — ${Object.values(checked.problems).join(', ')}`); continue; }
    const flag = [p.active ? '' : ' [login is deactivated]', p.name && norm(p.name) !== norm(h.name) ? ` [login name: ${p.name}]` : ''].join('');
    console.log(`${apply ? '+ CREATED' : '· would create'}  ${tag} → ${p.name} (by ${how})${flag}`);
    if (apply) await addCard(d, newId(), { ...checked.value, active: true, updatedBy: 'card-holders-setup' });
    usedLabel.add(h.label); usedDigits.set(digits, h.label); haveUser.set(p.id, h.label);
    tally.made += 1;
  }
  console.log(`\n${apply ? 'Created' : 'Would create'} ${tally.made} · already had a card ${tally.had} · no login ${tally.none} · several logins ${tally.many} · card in use/bad ${tally.clash} · of ${holders.length}`);
  if (!apply && tally.made) console.log('Dry run: nothing changed. Add --apply to create them.');
} finally { await close(); }
