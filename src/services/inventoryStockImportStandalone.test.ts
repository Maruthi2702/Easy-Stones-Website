import { it, expect } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import InventoryItem from '../models/InventoryItem.ts';
import { InventoryStockImport } from '../models/InventoryStockImport.ts';
import { importInventoryStock } from './inventoryStockImport.ts';

it('fails safely on a database without transaction support', async () => {
  const database = await MongoMemoryServer.create();
  try {
    await mongoose.connect(database.getUri());
    await InventoryItem.create({ product: 'OLD', location: 'Seattle', instockQty: 75 });
    await expect(importInventoryStock({ rows: [{ product: 'NEW', location: 'Seattle', instockQty: 75 }] }))
      .rejects.toThrow('Stock was not changed');
    expect(await InventoryItem.distinct('product')).toEqual(['OLD']);
    expect(await InventoryStockImport.countDocuments()).toBe(0);
  } finally { await mongoose.disconnect(); await database.stop(); }
}, 180000);
