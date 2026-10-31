import type { Loose } from '../types/records.ts';
import express from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.ts';
import { readSessionToken, resolveStaffToken } from '../services/staffIdentity.ts';
import { publicProduct } from '../utils/productView.ts';

export default function createPublicProductsRouter({ jwtSecret, getProducts }: { jwtSecret: Loose; getProducts: Loose }) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    try {
      const token = req.cookies?.adminToken || req.cookies?.customerToken
        || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      const decoded = readSessionToken(token, jwtSecret);
      let priceLevel = null;
      if (decoded?.type === 'customer' && mongoose.isValidObjectId(decoded.id)) {
        const customer = await Customer.findById(decoded.id, 'priceLevel isActive').lean();
        if (customer && customer.isActive !== false) priceLevel = customer.priceLevel || 1;
      } else if (decoded) {
        const staff = await resolveStaffToken(token, jwtSecret);
        if (staff && (staff.role === 'admin' || staff.permissions.includes('view_product_prices'))) priceLevel = 1;
      }
      const products = await getProducts();
      res.json(products.map((product: Loose) => {
        const result = publicProduct(product);
        const price = priceLevel === null ? undefined : product.priceLevels?.[`level${priceLevel}`];
        if (typeof price === 'number' && Number.isFinite(price)) result.price = `$${price.toFixed(2)}/sqft`;
        return result;
      }));
    } catch (error) {
      console.error('Error fetching products:', error);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });
  return router;
}
