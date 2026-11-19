import type { RequestHandler } from 'express';
import express from 'express';
import { canViewCustomerProfile, canImportCustomers } from '../utils/customerAccess.ts';
import { readSalesSheet } from '../utils/customerSales.ts';
import * as sales from '../db/customerSales/index.ts';

/**
 * Sales by customer, month by month (2026-11-18).
 *
 *   GET  /api/customers/:id/sales?year=2026   → the profile's Sales Report tab (needs the full profile switch)
 *   POST /api/customers/sales/import          { rows, fileName } → replaces that year (needs Import)
 *
 * `rows` is the SPS report "Sales by Customer - Monthly" as rows of cells; the
 * server reads it itself (src/utils/customerSales.ts) and refuses a file it
 * can't trust before writing anything. Mounted before the other /api/customers
 * routers so /sales/import isn't taken for a customer id.
 */
export default function createCustomerSalesRouter({ authenticate }: { authenticate: RequestHandler }) {
  const router = express.Router();
  const who = (req: express.Request) => req.user?.username || req.user?.name || '';

  router.post('/sales/import', authenticate, async (req, res) => {
    if (!canImportCustomers(req.user)) return res.status(403).json({ message: 'Your role can’t import customers.' });
    const sheet = readSalesSheet(req.body?.rows);
    if (sheet.problems.length) return res.status(400).json({ message: sheet.problems[0], problems: sheet.problems.slice(0, 20) });
    try {
      const done = await sales.replaceYear({
        year: sheet.year, entries: sheet.entries, totalCents: sheet.totalCents,
        fileName: String(req.body?.fileName || '').slice(0, 200), exportedOn: String(req.body?.exportedOn || '').slice(0, 60), by: who(req)
      });
      res.json({ year: sheet.year, ...done, totalCents: sheet.totalCents });
    } catch (err) {
      console.error('Sales import error:', err);
      res.status(500).json({ message: 'The sales import failed. Nothing was changed.' });
    }
  });

  router.get('/:id/sales', authenticate, async (req, res) => {
    if (!canViewCustomerProfile(req.user)) return res.status(403).json({ message: 'Your role can’t open the full customer profile.' });
    const id = String(req.params.id);
    if (!/^[0-9a-f]{24}$/i.test(id)) return res.status(404).json({ message: 'Customer not found' });
    const year = Number(req.query.year) || new Date().getFullYear();
    try {
      const out = await sales.salesForCustomer(id.toLowerCase(), year);
      if (!out) return res.status(404).json({ message: 'Customer not found' });
      res.json(out);
    } catch (err) {
      console.error('Customer sales error:', err);
      res.status(500).json({ message: 'Failed to load sales' });
    }
  });

  return router;
}
