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
 *   --unassigned          a holder with no matching login still gets their card, with no holder yet; the Cards tab
 *                         assigns it to a login later (and their Amex charges then ask for receipts)
 *   --locations           also gives each matched person the sheet's Location, ONLY if they have no home location, no assigned
 *                         locations and aren't on All locations (home + assigned, like Users & Roles → Locations); never
 *                         changes a location anyone already has. Works for people who already had their card too. One-time.
 *                         It also keeps the branch on each CARD (company_cards.location, blank ones only), so a card with
 *                         no holder yet shows its location in Cards; new cards are made with it.
 *   --leave=A,B           these Card IDs are never matched to a login (they get an unassigned card with --unassigned)
 * Needs DATABASE_URL (Render shell). Safe to run twice.
 */
import fs from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { openDb } from '../src/db/client.ts';
import { users, locations, userLocations } from '../src/db/schema/reference.ts';
import { companyCards } from '../src/db/schema/cardsSuppliers.ts';
import { addCard } from '../src/db/cardReceipts/postgres.ts';
import { cleanCard } from '../src/utils/cardReceipts.ts';
import { newId } from '../src/db/ids.ts';
import type { Db } from '../src/db/copy/plan.ts';

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const unassigned = process.argv.includes('--unassigned');
const withLocations = process.argv.includes('--locations');
const leave = new Set((process.argv.find(a => a.startsWith('--leave='))?.slice(8) || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
const url = process.env.DATABASE_URL;
if (!file || !url) { console.error('Usage: DATABASE_URL=… node scripts/card-holders-setup.ts holders.tsv [--apply]'); process.exit(1); }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
// Rows as the sheet has them (Sl.No, ID, Location, Name, Card ID, Mail …), with tabs OR plain spaces (a terminal
// paste turns tabs into spaces): the Card ID is the token like MARU92069; the words before it (after the leading
// numbers) are "Location Name"; the emails are the tokens with an @ after it. Rows marked Left or Inactive Card,
// and the header lines, are skipped.
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
const holders = lines
  .filter(l => !/\b(left|inactive card)\b/i.test(l))
  .flatMap(l => {
    const m = l.match(/(?:^|[\s\t])([A-Za-z]{3,6}\d{5})(?=[\s\t]|$)/);
    if (!m || m.index === undefined) return [];
    const before = l.slice(0, m.index).replace(/^[\s\d]+/, '').trim().replace(/\s+/g, ' ');
    const emails = l.slice(m.index + m[0].length).split(/[\s\t/]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
    return before ? [{ text: before, label: m[1]!.toUpperCase(), emails }] : [];
  });
console.log(`Read ${lines.length} lines → ${holders.length} card holders.`);
if (!holders.length) { console.error('No card holders found: each row needs a Card ID like MARU92069.'); process.exit(1); }

// An email on several holders (an office mailbox) says nothing about who is who: only the name decides then.
const mailCount = new Map<string, number>();
for (const h of holders) for (const e of new Set(h.emails)) mailCount.set(e, (mailCount.get(e) || 0) + 1);

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const people = await d.select({ id: users.id, name: users.displayName, username: users.username, email: users.email, active: users.isActive, home: locations.name })
    .from(users).leftJoin(locations, eq(locations.id, users.homeLocationId));
  const branches = await d.select({ id: locations.id, name: locations.name, short: locations.shortCode, full: locations.fullName }).from(locations);
  const assigned = new Set((await d.select({ userId: userLocations.userId }).from(userLocations)).map(r => r.userId));
  const everywhere = new Set((await d.select({ id: users.id }).from(users).where(eq(users.allLocations, true))).map(r => r.id));
  const placed = new Set<string>();
  // The branch the sheet row starts with ("Seattle Maruthi …", "Salt Lake City …"): longest name first, so a short one never beats a longer.
  const branchOf = (text: string) => {
    const t = norm(text);
    return [...branches].sort((a, b) => b.name.length - a.name.length)
      .find(b => [b.name, b.short, b.full].some(n => n && norm(n).length >= 2 && t.startsWith(norm(n)))) || null;
  };
  const tallyPlaces = { set: 0, had: 0, unknown: 0 };
  const fillLocation = async (p: { id: string; name: string; home: string | null }, text: string) => {
    if (!withLocations || placed.has(p.id)) return;
    placed.add(p.id);
    const b = branchOf(text);
    if (!b) { tallyPlaces.unknown += 1; console.log(`  ? NO BRANCH     ${p.name} — "${text}" starts with none of your locations`); return; }
    if (p.home || assigned.has(p.id) || everywhere.has(p.id)) { tallyPlaces.had += 1; console.log(`  = HAS LOCATION  ${p.name} — kept (${p.home || 'assigned / all'}), sheet says ${b.name}`); return; }
    console.log(`  ${apply ? '+ LOCATION' : '· would set'}    ${p.name} → ${b.name}`);
    if (apply) {
      await d.update(users).set({ homeLocationId: b.id }).where(eq(users.id, p.id));
      await d.insert(userLocations).values({ userId: p.id, locationId: b.id }).onConflictDoNothing();
    }
    assigned.add(p.id);
    tallyPlaces.set += 1;
  };
  const cards = await d.select().from(companyCards).where(eq(companyCards.active, true));
  const haveUser = new Map(cards.map(c => [c.userId, c.label]));
  const usedLabel = new Set(cards.map(c => c.label));
  const usedDigits = new Map(cards.map(c => [c.lastDigits, c.label]));
  const tally = { made: 0, had: 0, none: 0, many: 0, clash: 0 };
  const tallyCards = { set: 0, had: 0 };
  for (const h of holders) {
    const digits = h.label.slice(-5);
    const sheetBranch = withLocations ? branchOf(h.text) : null;
    if (sheetBranch) {
      const mine = cards.find(c => c.label === h.label);
      if (mine && !mine.location) {
        console.log(`  ${apply ? '+ CARD BRANCH' : '· would set'}  ${h.label} → ${sheetBranch.name}`);
        if (apply) await d.update(companyCards).set({ location: sheetBranch.name }).where(and(eq(companyCards.id, mine.id), eq(companyCards.location, '')));
        tallyCards.set += 1;
      } else if (mine) tallyCards.had += 1;
    }
    const own = h.emails.filter(e => mailCount.get(e) === 1);
    const byMail = people.filter(p => p.email && own.includes(p.email.toLowerCase()) && p.username !== 'admin');
    const byName = people.filter(p => norm(p.name).length > 3 && norm(h.text).endsWith(norm(p.name)) && p.username !== 'admin');
    const found = leave.has(h.label) ? [] : byMail.length === 1 ? byMail : byName.length ? byName : byMail;
    const tag = `${h.label.padEnd(10)} ${h.text}`;
    if (found.length === 0 && unassigned) {
      if (usedLabel.has(h.label) || usedDigits.has(digits)) { tally.had += 1; console.log(`= HAS A CARD    ${tag} — ${usedDigits.get(digits) || h.label} already exists`); continue; }
      const checked = cleanCard({ userId: '', issuer: 'amex', lastDigits: digits, label: h.label, location: sheetBranch?.name || '' }, { allowUnassigned: true });
      if (!checked.value) { tally.clash += 1; console.log(`✗ BAD CARD      ${tag} — ${Object.values(checked.problems).join(', ')}`); continue; }
      console.log(`${apply ? '+ CREATED' : '· would create'}  ${tag} → not assigned yet${leave.has(h.label) ? ' (left unassigned on purpose)' : ''}`);
      if (apply) await addCard(d, newId(), { ...checked.value, active: true, updatedBy: 'card-holders-setup' });
      usedLabel.add(h.label); usedDigits.set(digits, h.label);
      tally.made += 1;
      continue;
    }
    if (found.length === 0) { tally.none += 1; console.log(`✗ NO LOGIN      ${tag} — no staff login with that email or name (add --unassigned to make the card anyway)`); continue; }
    if (found.length > 1) { tally.many += 1; console.log(`✗ SEVERAL       ${tag} — ${found.map(p => `${p.name} <${p.email}>`).join('; ')}`); continue; }
    const p = found[0]!;
    await fillLocation(p, h.text);
    const how = byMail.length === 1 && byMail[0] === p ? 'email' : 'name';
    if (haveUser.has(p.id)) { tally.had += 1; console.log(`= HAS A CARD    ${tag} — already ${haveUser.get(p.id)}`); continue; }
    if (usedLabel.has(h.label) || usedDigits.has(digits)) { tally.clash += 1; console.log(`✗ CARD IN USE   ${tag} — ${usedDigits.get(digits) || h.label} is another person's`); continue; }
    const checked = cleanCard({ userId: p.id, issuer: 'amex', lastDigits: digits, label: h.label, location: sheetBranch?.name || '' });
    if (!checked.value) { tally.clash += 1; console.log(`✗ BAD CARD      ${tag} — ${Object.values(checked.problems).join(', ')}`); continue; }
    const flag = p.active ? '' : ' [login is deactivated]';
    console.log(`${apply ? '+ CREATED' : '· would create'}  ${tag} → ${p.name || p.username} (by ${how})${flag}`);
    if (apply) await addCard(d, newId(), { ...checked.value, active: true, updatedBy: 'card-holders-setup' });
    usedLabel.add(h.label); usedDigits.set(digits, h.label); haveUser.set(p.id, h.label);
    tally.made += 1;
  }
  console.log(`\n${apply ? 'Created' : 'Would create'} ${tally.made} · already had a card ${tally.had} · no login ${tally.none} · several logins ${tally.many} · card in use/bad ${tally.clash} · of ${holders.length}`);
  if (withLocations) console.log(`Card branches: ${apply ? 'set' : 'would set'} ${tallyCards.set} · already had one ${tallyCards.had}`);
  if (withLocations) console.log(`Locations: ${apply ? 'set' : 'would set'} ${tallyPlaces.set} · already had one ${tallyPlaces.had} · no branch matched ${tallyPlaces.unknown}`);
  if (!apply && tally.made) console.log('Dry run: nothing changed. Add --apply to create them.');
} finally { await close(); }
