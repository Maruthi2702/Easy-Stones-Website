import express from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { inScopePins, pinsForReps, repCountsOf, parseRepKeys } from '../utils/routePlannerScope.js';

/**
 * What the Route Planner's map reads (moved out of server.js, 2026-10-18).
 *
 *   GET /api/customers/map?reps=<id>,<id>,unassigned   the pins of those reps
 *   GET /api/customers/map/rep-counts                  how many each rep has
 *   GET /api/customers/map/:id                         one customer's details
 *
 * All need View Route Planner, and every answer is narrowed to the person's
 * scope first (src/utils/routePlannerScope.js: the locations assigned in Users
 * & Roles) — naming a rep outside it returns nothing, and a customer outside
 * it is "not found", so no request reaches past what the Filter would offer.
 * Without `reps` a request gets everyone in its scope (what an app that hasn't
 * updated yet still asks for).
 *
 * A pin is slim: where it is and what colours and lists need. The contact
 * details (phone, email, notes…) come only when a customer is opened — they were
 * most of every pin's size, and nobody reads them for a customer they never open.
 * The pins are built once and shared, then narrowed per person, so `cache` is the
 * host's one in-memory copy (busted by customer writes, including a logged visit,
 * the one write that changes a pin's last visit).
 *
 *   app.use('/api/customers', createCustomerMapRouter({ authenticate, requirePermission, cache }));
 */

/** Every customer we hold a point for, as slim pins. Visit dates are 'YYYY-MM-DD', so the newest is the largest string. */
export const buildMapPins = () => Customer.aggregate([
  { $match: { 'coordinates.lat': { $ne: null } } },
  {
    $project: {
      company: 1,
      contactName: 1,
      city: '$address.city',
      coordinates: 1,
      precision: '$geocode.precision',
      salesRep: 1,
      salesRepName: 1,
      customerType: 1,
      status: 1,
      location: 1,
      lastVisitAt: { $max: '$visits.date' },
      visitCount: { $size: { $ifNull: ['$visits', []] } }
    }
  },
  { $sort: { company: 1, contactName: 1 } }
]);

/** What opening a customer adds to its pin. */
export const mapDetailsOf = (c) => ({
  _id: c._id,
  phone: c.phone,
  email: c.email,
  marketingEmail: c.marketingEmail,
  street: c.address?.street,
  city: c.address?.city,
  state: c.address?.state,
  level: c.level,
  modaDisplay: c.modaDisplay,
  modaBinder: c.modaBinder,
  notes: c.quickNote
});

export default function createCustomerMapRouter({ authenticate, requirePermission, cache }) {
  const router = express.Router();
  const gate = [authenticate, requirePermission('view_route_planner')];

  const allPins = async () => {
    const cached = cache.get();
    return cached || cache.put(await buildMapPins());
  };

  /** The signed-in person as the scope rule reads them, and the staff it checks reps against. */
  const scopeFor = async (req) => {
    const me = req.authUserDoc || {};
    const staff = await User.find({}, 'username role location assignedLocations').lean();
    return {
      user: {
        id: req.userId ?? req.user?.id,
        role: req.userRole ?? req.user?.role,
        assignedLocations: me.assignedLocations || req.user?.assignedLocations || [],
        location: me.location || req.user?.location || ''
      },
      staff
    };
  };

  router.get('/map', ...gate, async (req, res) => {
    try {
      const [all, { user, staff }] = await Promise.all([allPins(), scopeFor(req)]);
      const scoped = inScopePins(all, user, staff);
      const keys = parseRepKeys(req.query.reps);
      res.json(keys ? pinsForReps(scoped, keys) : scoped);
    } catch (error) {
      console.error('Error building customer map:', error);
      res.status(500).json({ message: 'Failed to load customer map' });
    }
  });

  // How many customers each rep in the person's scope has, so the Filter can
  // show "Dana R. 310" without loading Dana's customers.
  router.get('/map/rep-counts', ...gate, async (req, res) => {
    try {
      const [all, { user, staff }] = await Promise.all([allPins(), scopeFor(req)]);
      res.json(repCountsOf(inScopePins(all, user, staff)));
    } catch (error) {
      console.error('Error counting customer map pins:', error);
      res.status(500).json({ message: 'Failed to count customers' });
    }
  });

  router.get('/map/:id', ...gate, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Not a customer id' });
    try {
      const [customer, { user, staff }] = await Promise.all([
        Customer.findById(req.params.id)
          .select('phone email marketingEmail address level modaDisplay modaBinder quickNote salesRep location')
          .lean(),
        scopeFor(req)
      ]);
      // Outside the scope reads the same as not there.
      if (!customer || inScopePins([customer], user, staff).length === 0) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      res.json(mapDetailsOf(customer));
    } catch (error) {
      console.error('Error loading map customer details:', error);
      res.status(500).json({ message: 'Failed to load customer' });
    }
  });

  return router;
}
