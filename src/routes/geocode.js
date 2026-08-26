import express from 'express';
import { zipToCityState } from '../utils/geocode.js';

/**
 * ZIP → city/state lookup, for the Add Customer form's autofill. Kept out of
 * server.js for the same reason as the other src/routes files — one small,
 * self-contained endpoint.
 *
 *   import createGeocodeRouter from './src/routes/geocode.js';
 *   app.use('/api/geocode', createGeocodeRouter({ authenticate }));
 */
export default function createGeocodeRouter({ authenticate }) {
  const router = express.Router();

  router.get('/zip/:zip', authenticate, async (req, res) => {
    const result = await zipToCityState(req.params.zip);

    if (result.status === 'ok') {
      return res.json({ city: result.city, state: result.state });
    }
    if (result.status === 'invalid') {
      return res.status(400).json({ message: result.error });
    }
    if (result.status === 'not_found') {
      return res.status(404).json({ message: 'ZIP code not found' });
    }
    // 'pending' — a network/quota/config problem on our end, not a bad ZIP.
    return res.status(502).json({ message: 'Could not look up that ZIP code right now' });
  });

  return router;
}
