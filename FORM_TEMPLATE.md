# Form template

Every form in the app — add/edit modals, the Delivery and Visit forms, Lost
Sale, imports, POD, profile — should look and behave the same way. This is the
agreed template, built from design **A · One clear form** on the
[Add New User canvas](https://claude.ai/artifact/PWd5rcmDu7oMziEt18redt)
(second row: *Template · Controls*, *Form behaviour*, *Phone*). Approved
2026-10-04.

**Status:** built (2026-10-05) in `src/components/shared/form/`:

- `FormModal`: the shell and all the behaviour below
- `FormControls`: section, row, field, password, toggle, picker, search
  picker (`FormSearchPicker`, for long lists such as customers), bottom sheet
- `useTouched`: when to show errors
- `formFocus`: Go to first and the Tab trap

**Add User** and **Edit User** (`src/components/sales/users/`) are on it, on
both Sales CRM → Users & Roles and the /admin page. **Add / Edit location**
(`src/components/sales/locations/LocationForm.jsx`, size L) is on it too.
**Add / Edit visit** (`src/components/sales/VisitForm.jsx`, size M; rules in
`src/utils/visitForm.js`) is on it, built from model C on the
[Add & Edit Visit canvas](https://claude.ai/artifact/UPcjj89doxCRsubhTrDZfN):
no section headings, follow-up behind a toggle, and **no Cancel button**
(owner's call, 2026-10-04: the ✕ closes, with the unsaved-changes check).
Whether every form drops Cancel is still open; until it's decided, the others
keep it.
The **Selection Sheet** (`src/components/sales/selectionSheet/SelectionSheetForm.jsx`,
size L; rules in `src/utils/selectionSheet.js`; design on the
[Selection Sheet canvas](https://claude.ai/artifact/VjjzPT6QRMaDWa3G9WVCCd)) is
on it too, with one deliberate phone exception (owner's call, 2026-10-04): no
footer — Save selection is a full-width button at the end of the body, and
Email / Print sit under a "…" button beside the ✕ (`FormModal`'s opt-in
`hideFooterOnPhone` and `headerActions`).
**Add / Edit customer** (`src/components/sales/CustomerForm.jsx`, size M; rules
in `src/utils/customerForm.js`) is on it, built from model A on the
[Add & Edit Customer canvas](https://claude.ai/artifact/G6YUNXvbtVqScRGB7dHtXD):
no headings, every account setting a dropdown, no Cancel, and the business
card (Scan card / Upload card photo) under a gold **+** beside the ✕
(`headerActions`; a bottom sheet on phones). It opens through
`AddCustomerModal` from Sales CRM, the Customers list and the route planner;
that modal's old read-only View is unchanged for now.
**Add / Edit delivery** (`src/components/sales/delivery/DeliveryForm.jsx`, size
L; rules in `src/utils/deliveryForm.js`) is on it, built from the
[Add & Edit Delivery canvas](https://claude.ai/artifact/MUFMQHSj2xPKo3o9JeXjXC)
with the owner's field order (2026-10-05): Date | Delivery type, Customer |
Sales rep, SO | No. of slabs, Driver | Status, Stop | Delivery address, then
Packing list and Notes. Picking the 3rd-party truck as Driver adds Carrier
name, BOL # and Agreed price (optional, owner's call 2026-10-05), on transfers
too. It keeps
Cancel. It replaced `DeliveryModal.jsx` on the Delivery Schedule board.
Move the other forms over **one at a time** and check each one by hand.
This is a live app, and `CLAUDE.md`'s shared-component rule applies,
especially to dropdowns inside a modal (see the CustomSelect z-index
incident). Use `FormPicker` (or `FormSearchPicker` for long lists) for new
dropdowns. On desktop the list **floats over the fields below it and never
pushes the form down** (owner's call, 2026-10-04): it's positioned inside its
field (`.fm-pop` / `.fm-menu`), not portaled, so it scrolls with the form and
can't land under a modal. It flips above the field when there's more room
there, and a long list scrolls inside it. On phones it's a bottom sheet. A
custom dropdown in a form (Locations, the Selection Sheet's material
suggestions) uses the same `.fm-pop` + `.fm-menu` classes.

## Layout

- **Header:** a title only, with no subtitle, and the ✕ close button on the
  right. The title says what is happening: "Add a user", or
  "Edit user · Alex Rivera".
- **Body:** fields in groups, separated by a thin divider. **No section
  headings unless the owner asks for them** (owner's call, 2026-10-05: the
  field labels already say what each group is). `FormSection` without a
  `title` gives the group and its divider. The title in the header ("Add a
  customer") stays: it names the form for everyone, including screen readers.
  Where two groups have the same fields (a primary and an accounting
  contact), say which is which in the field labels, or ask whether that form
  should keep headings.
- **Footer:** Cancel, then the main button, both on the right. The main
  button names the action ("Create user", "Save delivery"), never just "Save"
  or "Submit".
- **No helper text under fields.** The space under a field is only for error
  messages and live status such as "✓ Available".
- **Fixed header and footer.** Only the body scrolls. Show a soft shadow
  under the header and above the footer when the body is scrolled.

## Sizes

| Size | Width | For |
|---|---|---|
| S | 480px | Lost Sale, Manage colors, small confirmations |
| M | 760px | Most forms (Add User, Add Customer, Visit) |
| L | 960px | Delivery |

**Phone** (below 640px): the form fills the screen and fields stack in one
column. The footer is pinned to the bottom with **Cancel and the main button
side by side on one row**, both 50px tall, the main button twice as wide
(decided 2026-10-04, replacing a full-width button with Cancel as a text link
under it). An edit form's Deactivate/Delete sits on its own line above them,
the "Last changed by" note below; a form with no Cancel (a lone Done) gives
the main button the whole row. Inputs grow to 46px with
**16px text**. On iPhone, text smaller than 16px makes Safari zoom the page
every time a field is tapped.

## Scrolling on phones

Scrolling a long form on a phone has to feel effortless. These rules are part
of the template, not extras:

- **One scroll area: the form body.** The page behind the form must not
  move. While a form is open, lock the page scroll and restore the position
  on close, so it doesn't jump to the top. Nothing inside the body scrolls on
  its own. On a phone, dropdowns and the Locations multi-select open as a
  bottom sheet, not as a small scrolling list inside the form.
- **Native scrolling only.** Use the phone's own momentum scrolling: no
  scroll libraries, no JavaScript that moves the scroll position on a
  `scroll` event, no snap points. Use `overflow-y: auto` and
  `overscroll-behavior: contain`, so a fling stops at the end instead of
  pulling the page behind it or triggering pull-to-refresh.
- **No visible scrollbar** (owner's call, 2026-10-04: people know a form
  goes on below). The form body and bottom sheets hide it
  (`scrollbar-width: none` and `::-webkit-scrollbar`); scrolling by wheel,
  trackpad, touch and keyboard is unchanged.
- **Nothing that stutters while scrolling.** Don't put `backdrop-filter`
  blur or large animated shadows on content that scrolls. Use only passive
  scroll listeners, and nothing that re-renders React on every scroll. The
  header and footer shadows come from CSS, not JavaScript.
- **Use the real screen height.** Size the sheet with `100dvh`, not `100vh`,
  so it doesn't jump when the browser's address bar hides or shows. Pad the
  footer with `env(safe-area-inset-bottom)` so the button clears the iPhone
  home bar.
- **The keyboard never covers the field being typed in.**
  - When the keyboard opens, keep the footer above it by following
    `window.visualViewport` resizes.
  - Scroll the focused field to the middle of the visible area only if it is
    hidden.
  - Never scroll a field that is already in view.
- **Fewer, gentler jumps.**
  - Showing the error banner must not shift what the user is looking at.
  - "Go to first" scrolls smoothly, and instantly if the phone has Reduce
    Motion turned on (`prefers-reduced-motion`).
  - Tapping Next on the keyboard moves to the next field without jumping the
    page.
- **Less to scroll.** Keep the phone spacing compact: 14px between fields,
  no helper text, and no section headings. Tap targets
  must be at least 44px, so nobody scrolls back up to re-tap a missed
  control.
- **A short footer.** On phones the footer is the main button, then Cancel
  (and an edit form's Deactivate) on one line, then the note, about 130px.
  Stacking every action leaves too little room for the form.
- **No swipe-down to close.** On a form with typing in it, that closes
  forms by accident. Use ✕ and the unsaved-changes check.

**Verifying:** test on a real iPhone (Safari) and a real Android phone
(Chrome). Desktop device-emulation doesn't reproduce momentum scrolling, the
keyboard or the address bar. Fling a long form top to bottom, type into the
last field with the keyboard open, and trigger the error banner. Automated
tests can't check any of this.

## Fields

- **Height:** every control is 42px tall, so fields line up across forms.
- **Required fields:** a red `*` straight after the label text, on the same
  line. Optional fields have no marker.
- **Field states:**

  | State | Look |
  |---|---|
  | Normal | 1px border |
  | Typing | gold border plus a 3px gold ring |
  | Error | red border, a soft red ring, and a red message with an icon under the field |
  | Read-only | dashed border, grey text |

- **Controls in the set:**
  - text
  - dropdown (`CustomSelect`)
  - multi-select with tags and a checkbox list, as in Locations
  - date
  - a two-way toggle, as in Temporary password / Email an invite
  - password with a show/hide eye, hidden by default
  - checkbox (gold when ticked)

## Behaviour

- **Validation:**
  - Check a field when the user leaves it, but only if they typed in it.
    Tabbing or clicking past an empty field doesn't turn it red; Save
    catches it. Check everything again on Save.
  - Show an error from leaving a field only after the click that moved focus
    has finished. Otherwise the new error line pushes the form down under
    the pointer and the click misses its target.
    `shared/form/useTouched.js` does both.
  - On Save, a red banner at the top of the body reads
    "2 fields need attention — Full name, Joining date". Its "Go to first"
    link scrolls to the first problem and puts the cursor there.
- **Saving:**
  - The main button shows a spinner and "Saving…", and the fields lock.
  - A second click does nothing, which prevents duplicate records.
- **Unsaved changes:** if anything has been typed, ✕, Esc or a click outside
  asks "Discard …? You've filled in N fields." Its buttons are Keep editing
  (gold) and Discard (red).
- **Edit mode:**
  - Edit mode uses the same form as create (`submitDisabled` on FormModal).
  - Save changes stays greyed out until something changes.
  - Delete/Deactivate is disabled while there are unsaved changes, so a
    half-edited form is never thrown away by it.
  - Delete or Deactivate goes on the far left of the footer as red text.
  - The middle of the footer shows "Last changed by X · date".
- **Keyboard:** the cursor starts in the first field, Tab stays inside the
  form, Enter saves and Esc closes (with the unsaved-changes check).
  **Not on phones:** opening the keyboard before they've seen the form hides
  half of it, so the form opens with nothing focused.
- **Close button:**
  - Currently a red circle with a white ✕.
  - On hover the red darkens, the button grows to 1.08×, a soft red ring
    appears, the ✕ turns 90°, and a "Close without saving" tooltip shows.
  - Not settled yet: a grey ✕ that turns red on hover, which would stop red
    competing with the gold main button and with Delete. Both are on the
    canvas.

## Colours

The light theme uses slate greys with the deeper gold, so gold text stays
readable on white. The dark theme uses the app's own tokens from
`src/index.css`.

| Token | Light | Dark |
|---|---|---|
| Card | `#ffffff` | `#1c1c1e` (`--bg-card`) |
| Input background | `#ffffff` | `#111113` |
| Text | `#0f172a` | `#ffffff` |
| Label text | `#334155` | `#e5e5e5` |
| Muted text | `#5a6574` | `#999999` (`--text-muted`) |
| Border | `#cbd5e1` | `rgba(255,255,255,0.18)` |
| Gold (buttons, rings) | `#c9a227` | `#d4af37` (`--accent-primary`) |
| Gold as text | `#7a5c0b` | `#e6c25e` |
| Gold tint (number circles, home tag) | `#f6efd9` | `rgba(212,175,55,0.16)` |
| Error text | `#b91c1c` | `#f87171` |
| Error border | `#dc2626` | `#ef4444` |
| Error background | `#fef2f2` | `rgba(239,68,68,0.12)` |
| Success text | `#166534` | `#4ade80` |
| Text on gold buttons | `#1f1a08` | `#1a1505` |

The light theme is `body.light-theme-active`; dark is the default.
