---
name: customer-list-redesign
description: Customer List (PartnersSheet) redesign — design canvas link and the UX decisions the user approved before development
metadata:
  node_type: memory
  type: project
  originSessionId: dbf42a46-7fe0-4e79-8f4a-3016da729173
  modified: 2026-10-02T21:40:00.919Z
---

Redesign of the Customer List screen (`src/components/sales/PartnersSheet.jsx`) was mocked up first on a design canvas: https://claude.ai/artifact/RDzW76dbwD4AhG9rx9J5Rc (concepts A table, B split view, A+B table-with-detail-drawer, C pipeline). **Chosen direction (2026-10-02): A+B at every screen size** — A's table/list (with all A fixes) and B's customer detail on top: desktop = table + right detail drawer; iPad landscape = icon rail + table + 560px drawer; iPad portrait = list + 600px slide-over; phone = three-line list → full-screen detail (with Account section). Canvas row "A + B · Chosen direction" holds these boards (light + dark pages). C was not chosen. Nothing built in code yet as of 2026-10-02.

Decisions the user asked for / approved (2026-10-02):
- Status in tables/lists: coloured dot + short plain label, no pill background, fixed 130px column. Short labels: New lead, In discussion, Onboarding, Onboarded, Other rep, Not interested, Inactive. Closed-out statuses (Other rep / Not interested / Inactive) use a hollow grey ring + grey text. Full stored names stay in the Status filter, detail drawer and exports; stored enum values do not change.
- Status quick-filter is a single multi-select dropdown, not a chip row.
- Table shows each account's location (Seattle / Spokane / Salt Lake City / Dallas tags, reusing `.location-badge` tints) combined with the rep in a "Rep & location" column; filters say "Location", not "Branch".
- Full address column, "+N" extra-contacts badge, A–Z jump strip.
- "Moda" is labelled "Moda Resources" everywhere (column, filter, detail section).
- Copy buttons beside phone and email (and "Copy card" = `Name <email>, phone` for Outlook); Call/Email in the detail are split buttons defaulting to the primary contact with a per-contact menu + "Email all contacts".
- Customer type shown as a highlighted tag (app's existing `.customer-type-badge` colours).
- Mobile list = minimal three-line rows (initials, company, "contact · city", then location tag + sales rep name; status dot on the right); Call/Email/More via swipe-left; address/level/Moda/location only in the detail. User found the earlier rich cards "too complicated".
- Location filter is a dropdown listing only the locations the viewer has access to in Users & Roles (admins/directors see all).
- Sales rep filter lists only reps the viewer may see: Admin/Director → all reps, all locations; Manager → reps in their own location(s); Sales rep → only themselves + Unassigned. Follow the same location-scoping rule as Visits access.

- Approved enhancements (mocked on the canvas's Enhancements row): saved views (My accounts, Follow-ups due, Onboarding, No Moda display, Unassigned, Incomplete + "Save view"); **Changed 2026-10-02 at the user's request:** the saved-view chip row is gone — views are now a single dropdown (ViewPicker) at the start of the filter controls, and on desktop the views + filter dropdowns sit at the right of the Fabricators/Partners tabs row (no separate filter-bar row); narrow screens keep views dropdown + Filters sheet. Table/Map toggle with map selection → "Plan route with these customers" handing off to Route Planner (also "Plan route" in the table bulk bar); data-quality ⚠ for missing phone/email/address or failed geocode + "Incomplete" view; "Log this call?" sheet on mobile after tapping Call (saves to Check-In Log); duplicate warning in Add customer (existing customerMatch logic, "It's a different business" → notDuplicateOf); desktop keyboard shortcuts (/ search, ↑↓, Enter, Esc); skeleton loading + "No customers match" empty state.
- Clicking a customer must reach the full customer profile at every screen size: row click → quick drawer/slide-over with an "Open profile" button; clicking the company name (and on phone, tapping the row) → full profile. Profile tabs = Overview · Visits · Resources · Contacts · Network · Notes (the app's existing Visits/Resources/Contacts/Network tabs plus Overview & Notes); header has status, Call/Email split buttons, Directions, Add resource, Log visit, and a stats strip (last visit, visits 12 mo, resources, follow-up, customer since). Canvas row "Customer profile".
- Both light and dark themes required — the canvas has a "Dark theme" page with dark versions of every A/B/A+B/enhancement board.
- Level stays "Level" (no change, no merge with priceLevel). Old-ERP fields (payment terms, sales tax, DBA, second rep, referred by) are NOT being added.

- Build status (2026-10-02): built on branch `feat/customer-list-redesign`, uncommitted. Code in `src/components/sales/customerList/`, `PartnersSheet.jsx`, `src/utils/customerList.js` (+test), server routes `/api/partners` (view/letter/moda params, contactsCount), `/api/partners/view-counts`, `PATCH /api/partners/bulk`, `POST /api/partners/possible-duplicates`; profile header swapped into SalesPage; Route Planner `preselect` prop. Not built: a separate in-list Map view (Plan route hands off to Route Planner instead) and a profile "Overview" tab.

**Why:** user reviewed the mockups via canvas comments before any development and wants these carried into the build.
**How to apply:** when implementing the redesign, build from these decisions and the canvas; ask before re-opening any of them.
