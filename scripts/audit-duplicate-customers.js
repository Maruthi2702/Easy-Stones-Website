/**
 * Read-only audit: which customer records are the same business twice?
 *
 * Nothing is written or deleted. This only reports. To act on what it finds,
 * see scripts/merge-duplicate-customers.js, which reads the same groups from
 * the same matcher.
 *
 * Four independent signals are computed per record — normalized company name,
 * phone digits, each email address, and email domain — and records sharing any
 * of them are pulled into one candidate group, ranked by how many independent
 * signals agree. That is what separates "Olympic Peninsula Stone, Inc." and
 * "OLYMPIC PENINSULA STONE" (name AND phone AND domain) from four Strait Floors
 * branches that share a domain and nothing else.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Customer from '../src/models/Customer.js';
import {
  groupDuplicates, companyKey, phoneKey, emailKeys,
  isPlaceholderEmail, STRONG
} from '../src/utils/customerMatch.js';

dotenv.config();

const OWN_DOMAIN = /@easystones\.com$/i;

const label = (c) =>
  `${c.company || '(no company)'} — ${c.contactName || '(no contact)'} — ${c.email || '(no email)'}` +
  `${c.phone ? ` — ${c.phone}` : ''} — ${c.address?.city || 'no city'}` +
  ` — created ${new Date(c.createdAt).toISOString().slice(0, 10)}` +
  `${c.isActive === false ? ' — INACTIVE' : ''}`;

mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    const rows = await Customer.find(
      {},
      'company contactName email phone address createdAt isActive mergedInto'
    ).lean();

    const live = rows.filter(r => !r.mergedInto);
    const byId = new Map(live.map(r => [String(r._id), r]));
    const groups = groupDuplicates(live);

    const strong = groups.filter(g => g.score >= STRONG);
    const weak = groups.filter(g => g.score < STRONG);

    console.log(`\nTotal customers: ${live.length}${rows.length !== live.length ? `  (${rows.length - live.length} already merged away)` : ''}`);
    console.log(`Records touched by a duplicate signal: ${groups.reduce((n, g) => n + g.size, 0)}`);

    const show = (g, i) => {
      console.log(`\n  ${i + 1}. matched on ${g.signals.join(', ')}  —  ${g.size} records`);
      g.ids.map(id => byId.get(id))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .forEach(r => console.log(`     · ${label(r)}`));
    };

    console.log(`\n${'='.repeat(72)}`);
    console.log(`ALMOST CERTAINLY THE SAME BUSINESS — two or more signals agree: ${strong.length}`);
    console.log('='.repeat(72));
    strong.forEach(show);

    console.log(`\n${'='.repeat(72)}`);
    console.log(`WORTH A LOOK — one signal only: ${weak.length}`);
    console.log('A dealer with several branches legitimately looks like this: one');
    console.log('domain, one phone, separate records per location. Confirm before merging.');
    console.log('='.repeat(72));
    weak.forEach(show);

    // ── data quality, the reason duplicates get in ───────────────────────────

    const noCompany = live.filter(r => !companyKey(r.company));
    const noPhone = live.filter(r => !phoneKey(r.phone));
    const placeholderEmail = live.filter(r => isPlaceholderEmail(r.email || ''));
    const multiEmail = live.filter(r => emailKeys(r.email).length > 1);
    const ourAddress = live.filter(r => OWN_DOMAIN.test(r.email || ''));

    console.log(`\n${'='.repeat(72)}`);
    console.log('DATA QUALITY — what stops the next duplicate being spotted');
    console.log('='.repeat(72));
    console.log(`\n  No usable company name: ${noCompany.length}`);
    noCompany.slice(0, 10).forEach(r => console.log(`     · ${label(r)}`));
    console.log(`\n  No usable phone: ${noPhone.length}`);
    console.log(`\n  Invented email — unique by construction, so the unique index never fires: ${placeholderEmail.length}`);
    placeholderEmail.slice(0, 10).forEach(r => console.log(`     · ${label(r)}`));
    console.log(`\n  Several addresses in one email field: ${multiEmail.length}`);
    multiEmail.forEach(r => console.log(`     · ${r.company} — ${r.email}`));
    console.log(`\n  Our own address in the customer's email field: ${ourAddress.length}`);
    ourAddress.forEach(r => console.log(`     · ${label(r)}`));

    // A single day accounting for most of the records is an import, and imports
    // are where the second copy of an existing customer comes from.
    const byDay = live.reduce((m, r) => {
      const d = new Date(r.createdAt).toISOString().slice(0, 10);
      m[d] = (m[d] || 0) + 1;
      return m;
    }, {});
    console.log('\n  Busiest creation days (a spike is an import):');
    Object.entries(byDay).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([d, n]) => console.log(`     ${d}  ${String(n).padStart(4)}  (${Math.round(n / live.length * 100)}% of all customers)`));

    await mongoose.disconnect();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
