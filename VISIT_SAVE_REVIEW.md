# Visit save changes for local review

Changes are local and uncommitted. Nothing has been pushed or deployed.
Other customer/resource changes are also present in the shared workspace; this note describes only the visit-save work.

## Behavior

- Save waits for selected photos/PDFs to finish preparation, then closes the form and saves in the background. The form shows Saving while it waits; repeated submits during preparation are ignored.
- Attachment jobs belong to their original form. Closing one form and opening another cannot put an old file in the new form.
- Automatic and manual retries retain the same new-visit ID for the same customer. Starting a fresh visit gets a fresh ID.
- An unreadable success response is retried with the same ID before showing Visit saved.
- The saved response updates customer history and its last-visit summary. Older customer reads cannot overwrite those changes or switch the open profile back to another customer.

## Request changes

For the tested case of a new staff visit on Dashboard → Visits, with no attachments or other open consumers:

| Request | Count |
| --- | ---: |
| Save visit | 1 |
| Refresh visits, follow-up list, follow-up preview and statistics | 4 |
| Refresh calendar after the server finishes linking the visit | 1 |
| Total | 6 |

The earlier code trace counted roughly 16 requests for this case. The combined hook tests now assert six, with the local socket echo arriving either before or after the save response. This is a test measurement, not a live deployment benchmark.

- Visit saves send a scoped customer_update hint containing IDs, not visit contents. Other browsers fetch using their own permissions and current filters.
- The saving browser recognizes its own mutation ID; its response handles the update, avoiding duplicate refreshes.
- Visit-only refreshes skip resources, customer directory/dropdown reads and a full customer refetch. Multiple visit changes share the existing two-second refresh delay; a hidden dashboard waits until reopened.
- Full customer/resource changes retain their existing refresh behavior. A resource change in the same burst still refreshes resources.
- Calendar updates follow the server's existing schedule_update event and reconnect/focus recovery. A calendar-link failure remains a server-side logged error; this work does not introduce a background job queue.

Attachments add their upload requests. Retries, a separate open follow-up panel or planner, and moving an edited visit between dates can add requests. New UI with an older server still takes the generic refresh path.

## Review locations

- `src/features/visits/useVisitEditor.ts`: preparation tracking, form sessions, stable retry IDs and save-response handling.
- `src/features/visits/visitMutations.ts`: bounded memory of this browser's recent save IDs.
- `src/routes/visits.ts`: scoped save events for new and edited visits.
- `src/features/salesShell/useSalesLiveUpdates.ts`: local-echo handling and targeted remote refresh.
- `src/features/dashboard/useDashboardData.ts`: visit-only refresh scheduling and independent resource error/request handling.
- `src/features/customers/useOpenCustomer.ts`: saved-visit summaries and protection against stale profile reads.
- `src/pages/SalesPage.tsx` and `src/features/salesShell/SalesModals.tsx`: wiring. SalesPage also contains unrelated workspace edits.

## Suggested manual review

1. Select a photo or PDF and immediately press Save. Confirm it appears on the stored visit.
2. Simulate lost save responses, let the form reopen, then retry. Confirm only one visit exists.
3. Save while viewing a customer profile; confirm its history and last-visit summary update. Return to the dashboard and confirm totals catch up.
4. Keep a second browser open with different People/location filters. Save in the first and confirm both views remain correctly scoped.
5. Inspect network requests on Dashboard → Visits. Confirm no resource or customer-dropdown refresh is caused by the visit save.

Automated coverage includes these save races, both socket-echo timings, hidden-dashboard refreshes, mixed resource/visit invalidations, permission-scoped API reads, duplicate POSTs and calendar-link rules.

## Validation

- 129 targeted tests passed: 92 form/dashboard/socket/customer/calendar/rules tests and 37 visit API/customer-history integration tests using a disposable MongoDB.
- Production build, including TypeScript checks, passed.
- Lint for the files changed by this task passed; diff whitespace checks passed.
- Repository-wide lint reported unrelated errors in CustomerFinder, payments, permits and a transfer-arrival test. Those files were left untouched.
