# Fuel Man

Accounting → Fuel Man (`/sales?tab=fuel_man`) reads original Fuelman Employee
Management PDFs, remembers driver-to-location assignments, requires review of
new/missing identities, and publishes an approved monthly expense component
for location P&L. React components are TSX; backend/domain code is TypeScript.
No new dependencies are required.

## User workflow

1. Upload one or several complete calendar-month PDFs. The backend determines
   the dates, account and fleet. Start review with the earliest month.
2. On the first report, assign each reported employee number to a system
   user with a Driver profile in Users & Roles and a cost location. Multiple
   locations must total exactly 100%. Effective dates support transfers.
   **Assign locations** opens a group form for up to 100 unmatched drivers;
   each identity/location is confirmed, with an optional user-selected location
   applied to the group. Save completed matches while others remain pending.
   The backend saves the submitted group atomically.
3. Later reports reuse dated assignments. Names and ID suffixes never decide
   the branch. Possible name matches are suggestions requiring confirmation.
4. Give every missing identity a reason and note. No activity, leave and
   transfer resolve only that month's absence; retirement and confirmed ID
   changes end the old identity's expected interval. Incomplete/investigating
   reasons keep approval blocked. No website account is deactivated.
5. Inspect source transactions and classify ambiguous expenses. Preview the
   branch allocation before approving. The original source amount cannot be
   edited in this workflow; upload a corrected report instead.
6. Approve to include the report in location totals. View monthly fuel, DEF,
   supplies, non-fuel taxes, signed adjustments and driver totals, or export
   the approved P&L component as CSV. Uploaded driver expenses are visible
   immediately. Draft location totals include an explicit **Unassigned** row
   until mappings are confirmed; this row never becomes a real branch or a
   published expense. Source details stay below the report rows.

## Data and accounting rules

- The first PDF page is an exceptions-only summary. It is not an expense
  ledger or the complete driver roster. All employee detail pages are read.
- All pages must be present in order. Each employee's detail line count,
  section totals and final printed total (when present) must reconcile.
- Fuel's reported Total AMT already includes its taxes. Non-fuel taxes are
  separate expense lines. Signed adjustments are preserved; subtotals never
  become additional expenses. DEF and antifreeze are recognized separately
  as DEF and supplies. Ambiguous miscellaneous purchases require review.
- Money stays in integer cents. Percentage splits use integer basis points
  and deterministic largest-remainder rounding, including negative credits.
- Expenses post to the **statement month**; the transaction date selects the
  historical driver/location assignment. Pre-statement transactions are
  flagged and require explicit acknowledgement at approval.
- Reported IDs are scoped to account + fleet and retained exactly. They are
  labels, not guaranteed immutable person IDs. Aliases require a confirmed
  system-driver match. Station location never implies the cost location.
- The driver picker reads existing Users whose role grants Driver view,
  including custom driver roles. Report imports never create users or separate
  driver profiles. A selected user's unambiguous home location prefills an empty
  cost location for confirmation; manual splits and locations are preserved.
  Historical inactive drivers remain available for explicit mapping.

## Backend structure

`src/fuelman/` owns parsing, identity review, allocation, permissions, validation,
storage, publication and queries. `src/features/fuelman/` owns presentation,
form state and API calls. The browser neither parses PDFs nor calculates
financial allocations. Forms use the shared FormModal, date/month pickers,
LocationPicker and Pagination; colors come from canonical theme tokens.

Collections:

| Collection | Purpose |
| --- | --- |
| `acct_fuelman_reports` | Immutable parsed source, revision and review decisions |
| `acct_fuelman_sources` | Private original PDF, excluded from ordinary queries |
| `acct_fuelman_assignments` | Dated reported-ID → driver → location shares |
| `acct_fuelman_profiles` | Legacy expense profiles retained for existing history |
| `acct_fuelman_expenses` | Approved, immutable transaction/location facts |
| `acct_fuelman_periods` | Current published revision and period close state |
| `acct_fuelman_state` | Fleet transaction fence and change revision |
| `acct_fuelman_history` | Actor, action, date, note and before/after audit |

All mutations serialize through the fleet state document in MongoDB snapshot
transactions. A replica set is required, matching existing accounting flows.
Report versions and review tokens reject stale decisions, including assignment
changes made while reviewing a different report. Published facts and their
review snapshot remain frozen when future mappings change.

File SHA-256 and a normalized semantic transaction multiset detect duplicate
uploads/re-exports. Repeated legitimate purchases are preserved. Corrected
content creates a new monthly revision. Approval atomically switches the
period pointer; it never sums both old and corrected revisions. Replacement,
reversal and restoration require explicit permissions and notes. Closed
periods block those operations until reopened. Facts/history are retained.

PDF extraction uses a worker thread with a 30-second deadline, 256 MB heap,
two concurrent reads, a 10 MB upload cap and a 100-page limit. This adapter
supports original text-based FN03 Employee Management reports. Image-only or
changed report layouts fail with a readable error rather than inferred costs.

## API

All endpoints are authenticated under `/api/accounting/fuel-man` and require
`view_fuel_man`.

| Method / path | Purpose |
| --- | --- |
| GET `/metadata`, `/revision` | Permitted locations, drivers, actions and refresh revision |
| POST `/reports` | Upload one PDF using multipart `file` |
| GET `/reports` | Paginated monthly report/revision list |
| GET `/reports/:id` | Backend-calculated review and allocation preview |
| GET `/reports/:id/lines`, `/reports/:id/history` | Paginated detail/audit |
| GET `/reports/:id/source` | Authorized original PDF download |
| POST `/reports/:id/assignments/batch` | Confirm a group of driver/location assignments atomically |
| POST `/reports/:id/assignments` | Save a dated assignment/location split |
| POST `/reports/:id/missing` | Record/change a missing identity disposition |
| POST `/reports/:id/classifications` | Categorize ambiguous expense lines |
| POST `/reports/:id/publish`, `/reverse`, `/period` | Approve, correct, reverse or close/reopen |
| GET `/pnl?month=YYYY-MM&location=...` | Approved monthly branch/driver expense component |
| GET `/pnl?month=YYYY-MM&format=csv` | Export approved P&L input |

Users & Roles exposes View, Import, Reconcile, Approve, Reverse/replace, Close
periods, Export and History independently. Existing admin permission seeding
grants new keys using the repository's established mechanism.

Company-wide import/review/source access requires all-location access. Branch
readers receive only their published allocated shares; draft reports,
company-wide PDFs, private review notes, full raw amounts and other branches'
allocations are excluded. CSV formula-like text is escaped while numeric
credits remain numeric.

This component does not create payments or a second general ledger. A future
consolidated location P&L should consume `/pnl` (source `fuel_man`, basis
`statement-month`) rather than importing the CSV twice or summing all stored
fact revisions.

## Validation

- Synthetic parser tests: exceptions vs detail, section totals, missing pages,
  continued sections, source flags, signed amounts and duplicate signatures.
- Disposable-replica-set API tests: mapping reuse, dated allocation, missing
  reasons/aliases, roster correction, unknown categories, duplicates, concurrent
  approvals, stale review tokens, corrected revisions, period close/reversal,
  Driver user selection and branch privacy.
- React tests: allocation preview, action permissions, blocked approval,
  preserved input after stale rejection and pre-statement acknowledgement.
- Manual browser automation against the three supplied July/August/September
  PDFs, using a disposable database and test-only mappings. Original PDFs and
  detailed financial records stay outside the repository and production
  database during validation.

The supplied reports reconcile to 416 / 372 / 422 detail lines and totals
$82,953.79 / $83,091.05 / $99,107.76 respectively. September contains one
August-dated transaction, which is preserved and flagged for review.
