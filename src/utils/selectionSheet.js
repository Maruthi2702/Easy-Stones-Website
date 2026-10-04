/**
 * The Selection Sheet (Check-In Log → a visit's clipboard button): the rules
 * shared by the form (src/components/sales/selectionSheet/SelectionSheetForm.jsx)
 * and its tests. Pure functions only — no React, no network.
 *
 * A sheet is a check-in's sales rep, up to SHEET_ROWS material rows
 * (material / lot / slab numbers / size) and special notes; the record lives
 * on OfficeCheckIn and is saved with PUT /api/checkin/:id.
 */

export const SHEET_ROWS = 12;
// How many rows a new or short sheet shows before anyone presses "Add".
export const MIN_VISIBLE_ROWS = 3;
export const ROW_FIELDS = ['material', 'lot', 'details', 'size'];

export const emptyRow = () => ({ material: '', lot: '', details: '', size: '' });

// A row is kept on save if *any* field is filled — a lot or slab numbers
// typed before the material is known still count.
export const rowHasData = (row) => ROW_FIELDS.some((k) => String(row?.[k] || '').trim());

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A check-in → the form's values. */
export const sheetValuesFromCheckIn = (checkIn = {}) => {
  const saved = (Array.isArray(checkIn.selections) ? checkIn.selections : [])
    .map((r) => ({ material: str(r?.material), lot: str(r?.lot), details: str(r?.details), size: str(r?.size) }))
    .filter(rowHasData)
    .slice(0, SHEET_ROWS);
  const rows = [...saved];
  while (rows.length < MIN_VISIBLE_ROWS) rows.push(emptyRow());
  return {
    salesRep: str(checkIn.salesRep),
    salesRepEmail: str(checkIn.salesRepEmail),
    builderName: str(checkIn.builderName),
    builderPhone: str(checkIn.builderPhone),
    rows,
    specialNotes: str(checkIn.specialNotes)
  };
};

// What a save would send, normalized so two snapshots compare field by field.
const comparable = (v) => ({
  salesRep: str(v.salesRep).trim(),
  builderName: str(v.builderName).trim(),
  builderPhone: str(v.builderPhone).trim(),
  specialNotes: str(v.specialNotes).trim(),
  rows: (v.rows || []).filter(rowHasData).map((r) => ROW_FIELDS.map((k) => str(r[k]).trim()))
});

/** How many fields differ — the number the unsaved-changes check reports. */
export const countSheetChanges = (values, initial) => {
  if (!values || !initial) return 0;
  const a = comparable(values);
  const b = comparable(initial);
  let n = ['salesRep', 'builderName', 'builderPhone', 'specialNotes'].filter((k) => a[k] !== b[k]).length;
  for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i++) {
    n += ROW_FIELDS.filter((_, f) => (a.rows[i]?.[f] || '') !== (b.rows[i]?.[f] || '')).length;
  }
  return n;
};

/**
 * The PUT body. `expectedUpdatedAt` is the check-in's updatedAt when the
 * sheet was loaded — the server answers 409 if someone saved since.
 */
export const sheetPayload = (values, expectedUpdatedAt) => ({
  builderName: str(values.builderName),
  builderPhone: str(values.builderPhone),
  salesRep: str(values.salesRep),
  salesRepEmail: str(values.salesRepEmail),
  specialNotes: str(values.specialNotes),
  selections: (values.rows || []).filter(rowHasData).map((r) => ({
    material: str(r.material).trim().toUpperCase(),
    lot: str(r.lot).trim(),
    details: str(r.details).trim(),
    size: str(r.size).trim()
  })),
  ...(expectedUpdatedAt ? { expectedUpdatedAt } : {})
});

const SELLING_ROLES = ['sales', 'manager', 'director', 'admin'];

/**
 * Who can be picked as the sheet's sales rep: active staff in a selling role
 * who work at the check-in's branch (or every branch). Someone deactivated in
 * Users & Roles is never offered — the sheet emails its rep on every change —
 * but one already named on this sheet still shows, marked, so it doesn't
 * silently disappear.
 *
 * @returns {{ value, label, email }[]} sorted by name, value = the rep's name
 */
export const salesRepOptions = (reps = [], branch = '', current = { name: '', email: '' }) => {
  const list = (Array.isArray(reps) ? reps : [])
    .filter((r) => r && r.isActive !== false && String(r.name || '').trim())
    .filter((r) => {
      const role = String(r.role || '').toLowerCase();
      return !role || SELLING_ROLES.some((s) => role.includes(s));
    })
    .filter((r) => !branch || r.location === branch
      || (r.assignedLocations || []).includes(branch) || (r.assignedLocations || []).includes('*'))
    .map((r) => ({ value: String(r.name).trim(), label: String(r.name).trim(), email: str(r.email) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const unique = list.filter((o, i) => list.findIndex((x) => x.value === o.value) === i);
  const name = str(current.name).trim();
  if (name && !unique.some((o) => o.value === name)) {
    const known = (Array.isArray(reps) ? reps : []).find((r) => String(r?.name || '').trim() === name);
    unique.unshift({
      value: name,
      label: known?.isActive === false ? `${name} (inactive)` : name,
      email: str(current.email)
    });
  }
  return unique;
};

// Everything written into the print window is visitor- or staff-entered text
// in our own origin, so every value is escaped (the kiosk name used to run as
// script).
export const escapeHtml = (value) => str(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * The printable page for a sheet — what's on screen, saved or not.
 * `letterhead` is letterheadFor(location) from src/utils/locationForm.js.
 */
export const buildSelectionSheetHtml = ({ checkIn = {}, dateStr = '', values, letterhead }) => {
  const salesRep = values.salesRep;
  const specialNotes = values.specialNotes;
  const validSelections = (values.rows || []).filter(rowHasData);
  let selectionsRowsHtml = '';
  if (validSelections.length === 0) {
    selectionsRowsHtml = `
        <tr>
          <td colspan="5" style="padding: 12px 10px; text-align: center; color: #666; font-style: italic;">No selections registered.</td>
        </tr>
      `;
  } else {
    validSelections.forEach((sel, idx) => {
      selectionsRowsHtml += `
          <tr style="border-bottom: 1px solid #eaeaea;">
            <td style="padding: 10px; text-align: center; color: #d4af37; font-weight: bold;">${idx + 1}</td>
            <td style="padding: 10px; color: #222; font-weight: 500;">${escapeHtml(sel.material) || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${escapeHtml(sel.lot) || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${escapeHtml(sel.details) || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${escapeHtml(sel.size) || 'N/A'}</td>
          </tr>
        `;
    });
  }
  return `
      <html>
        <head>
          <title>Selection Sheet - ${escapeHtml(checkIn.name)}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #333;
              margin: 40px;
              padding: 0;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #d4af37;
              padding-bottom: 15px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
              font-weight: 800;
              letter-spacing: 1px;
            }
            .header p {
              margin: 5px 0 0 0;
              color: #666;
              font-size: 13px;
            }
            .title {
              text-align: center;
              font-size: 16px;
              font-weight: bold;
              letter-spacing: 1px;
              color: #d4af37;
              text-transform: uppercase;
              margin-bottom: 25px;
            }
            .details-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              background: #fff;
              border: 1px solid #eaeaea;
              border-radius: 12px;
              padding: 20px;
              margin-bottom: 30px;
            }
            .detail-item {
              font-size: 14px;
            }
            .detail-label {
              font-weight: bold;
              color: #555;
            }
            .detail-value {
              color: #222;
            }
            .section-title {
              font-size: 14px;
              margin: 20px 0 12px 0;
              color: #111;
              border-left: 3px solid #d4af37;
              padding-left: 8px;
              text-transform: uppercase;
              font-weight: bold;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 30px;
              font-size: 13px;
            }
            th {
              background: #f1f5f9;
              border-bottom: 2px solid #e2e8f0;
              padding: 10px;
              text-align: left;
              color: #475569;
              font-weight: bold;
            }
            td {
              padding: 10px;
              border-bottom: 1px solid #eaeaea;
            }
            .notes {
              background: #fff;
              border: 1px solid #eaeaea;
              border-radius: 12px;
              padding: 15px;
              margin-bottom: 30px;
              font-size: 13px;
            }
            .notes h4 {
              margin: 0 0 8px 0;
              color: #475569;
            }
            .notes p {
              margin: 0;
              color: #334155;
              white-space: pre-wrap;
              line-height: 1.5;
            }
            .policy-box {
              background: #fef2f2;
              border: 1px dashed #fca5a5;
              border-radius: 12px;
              padding: 15px;
              margin-bottom: 40px;
              font-size: 12px;
              color: #ef4444;
              line-height: 1.5;
            }
            .footer {
              text-align: center;
              font-size: 11px;
              color: #888;
              margin-top: 30px;
            }
            @media print {
              body {
                margin: 20px;
              }
              .policy-box {
                background: #fff !important;
                border: 1px dashed #ef4444 !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>EASY STONES</h1>
            <p>${escapeHtml(letterhead.addressLine)}</p>
            ${letterhead.contactLine ? `<p>${escapeHtml(letterhead.contactLine)}</p>` : ''}
          </div>
          
          <div class="title">Customer Visit / Stone Selection</div>
          
          <div class="details-grid">
            <div class="detail-item"><span class="detail-label">Date:</span> <span class="detail-value">${escapeHtml(dateStr)}</span></div>
            <div class="detail-item"><span class="detail-label">Customer Name:</span> <span class="detail-value">${escapeHtml(checkIn.name)}</span></div>
            <div class="detail-item"><span class="detail-label">Phone Number:</span> <span class="detail-value">${escapeHtml(checkIn.phone)}</span></div>
            <div class="detail-item"><span class="detail-label">Company Name:</span> <span class="detail-value">${escapeHtml(checkIn.fabricatorCompany) || 'N/A'}</span></div>
            <div class="detail-item"><span class="detail-label">Company Phone:</span> <span class="detail-value">${escapeHtml(checkIn.fabricatorPhone) || 'N/A'}</span></div>
            <div class="detail-item"><span class="detail-label">Sales Rep:</span> <span class="detail-value">${escapeHtml(salesRep) || 'N/A'}</span></div>
          </div>
          
          <div class="section-title">Material Selection(s)</div>
          <table>
            <thead>
              <tr>
                <th style="width: 5%; text-align: center;">#</th>
                <th>Material Name</th>
                <th>Lot/Bundle Number</th>
                <th>Slab Numbers</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              ${selectionsRowsHtml}
            </tbody>
          </table>
          
          ${specialNotes ? `
          <div class="notes">
            <h4>Special Notes:</h4>
            <p>${escapeHtml(specialNotes).replace(/\n/g, '<br>')}</p>
          </div>
          ` : ''}
          
          <div class="policy-box">
            <strong>Hold Policy Note:</strong> Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.
          </div>
          
          <div class="footer">
            This is an automated selection record from the Easy Stones Check-In Portal.
          </div>
          
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `;
};
