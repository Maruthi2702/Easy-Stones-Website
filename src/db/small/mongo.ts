/** The small ones on MongoDB: the routes' own Mongoose calls, moved here unchanged (server.ts held them). */
import mongoose from 'mongoose';
import Product from '../../models/Product.ts';
import CrossoverSheet from '../../models/CrossoverSheet.ts';
import EasyStonesColor from '../../models/EasyStonesColor.ts';
import ContactSubmission from '../../models/ContactSubmission.ts';
import SalesResource from '../../models/SalesResource.ts';
import type { Loose } from '../../types/records.ts';
import { escapeRegex, hasDuplicateMapping, type CrossoverResult } from './crossoverRules.ts';

// ── contact form ──
export async function createContact(fields: Loose, _id: string): Promise<Loose> {
  const doc = new ContactSubmission({ _id, ...fields, status: 'new', emailSent: false });
  await doc.save();
  return doc.toObject();
}
export async function markContactEmailSent(id: string): Promise<void> {
  await ContactSubmission.updateOne({ _id: id }, { $set: { emailSent: true } });
}

// ── Easy Stones colours ──
export const listColors = async (): Promise<Loose[]> => EasyStonesColor.find().sort({ order: 1 }).lean();
export async function seedColorsIfEmpty(names: string[], ids: string[]): Promise<boolean> {
  if (await EasyStonesColor.countDocuments() !== 0) return false;
  await EasyStonesColor.insertMany(names.map((name, order) => ({ _id: ids[order], name, order })));
  return true;
}
export async function addColor(name: string, _id: string): Promise<Loose | 'exists'> {
  const existing = await EasyStonesColor.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
  if (existing) return 'exists';
  const highest = await EasyStonesColor.findOne().sort({ order: -1 }).lean();
  return EasyStonesColor.create({ _id, name, order: (highest?.order ?? -1) + 1 });
}
export const renameColor = async (id: string, name: string): Promise<Loose | null> =>
  EasyStonesColor.findByIdAndUpdate(id, { name }, { new: true, runValidators: true });
export const deleteColor = async (id: string): Promise<boolean> => !!(await EasyStonesColor.findByIdAndDelete(id));

// ── sales resources (the old admin list) ──
export const listSalesResources = async (): Promise<Loose[]> => SalesResource.find().sort({ createdAt: -1 });
export async function createSalesResource(fields: Loose, _id: string): Promise<Loose> {
  const doc = new SalesResource({ _id, ...fields, createdAt: new Date() });
  await doc.save();
  return doc;
}
export const deleteSalesResource = async (id: string): Promise<void> => { await SalesResource.findByIdAndDelete(id); };

// ── Crossover Sheet ──
export const listCrossovers = async (): Promise<Loose[]> => CrossoverSheet.find().sort({ easyStonesName: 1 }).lean();

async function canonicalName(rawName: string, session: mongoose.ClientSession | null = null) {
  const regex = { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' };
  let existingQuery = CrossoverSheet.findOne({ easyStonesName: regex }, { easyStonesName: 1 });
  if (session) existingQuery = existingQuery.session(session);
  const [existingDoc, catalogColor] = await Promise.all([existingQuery.lean(), EasyStonesColor.findOne({ name: regex }, { name: 1 }).lean()]);
  return existingDoc?.easyStonesName || catalogColor?.name || rawName;
}

export async function addMapping(rawName: string, entry: Loose, ids: { color: string; entry: string }): Promise<CrossoverResult> {
  const easyStonesName = await canonicalName(rawName);
  const existingDoc = await CrossoverSheet.findOne({ easyStonesName }, { crossovers: 1 }).lean();
  if (hasDuplicateMapping(existingDoc?.crossovers, entry.distributorName, entry.distributorColorName)) {
    return { status: 409, message: 'This distributor mapping already exists for this color' };
  }
  const colorDoc = await CrossoverSheet.findOneAndUpdate(
    { easyStonesName },
    { $push: { crossovers: { _id: ids.entry, ...entry } }, $setOnInsert: { _id: ids.color } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return { status: 201, body: colorDoc };
}

export async function editMapping(colorId: string, crossoverId: string, rawNewName: string, fields: Loose, ids: { color: string }): Promise<CrossoverResult> {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const colorDoc = await CrossoverSheet.findById(colorId).session(session);
    const entry = colorDoc?.crossovers.id(crossoverId);
    if (!colorDoc || !entry) { await session.abortTransaction(); return { status: 404, message: 'Crossover entry not found' }; }
    const newEasyStonesName = rawNewName ? await canonicalName(rawNewName, session) : colorDoc.easyStonesName;
    const moved = newEasyStonesName !== colorDoc.easyStonesName;
    let colorDocResult!: Loose;
    if (moved) {
      const destDoc = await CrossoverSheet.findOne({ easyStonesName: newEasyStonesName }).session(session);
      if (hasDuplicateMapping(destDoc?.crossovers, fields.distributorName, fields.distributorColorName)) {
        await session.abortTransaction();
        return { status: 409, message: 'This distributor mapping already exists for the destination color' };
      }
      const movedEntry = { ...entry.toObject(), ...fields };
      entry.deleteOne();
      if (colorDoc.crossovers.length === 0) await CrossoverSheet.findByIdAndDelete(colorId, { session });
      else await colorDoc.save({ session });
      colorDocResult = await CrossoverSheet.findOneAndUpdate(
        { easyStonesName: newEasyStonesName },
        { $push: { crossovers: movedEntry }, $setOnInsert: { _id: ids.color } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
      );
    } else {
      if (hasDuplicateMapping(colorDoc.crossovers, fields.distributorName, fields.distributorColorName, crossoverId)) {
        await session.abortTransaction();
        return { status: 409, message: 'This distributor mapping already exists for this color' };
      }
      Object.assign(entry, fields);
      await colorDoc.save({ session });
      colorDocResult = colorDoc;
    }
    await session.commitTransaction();
    return { status: 200, body: { moved, sourceColorId: colorId, colorDoc: colorDocResult } };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    session.endSession();
  }
}

export async function deleteMapping(colorId: string, crossoverId: string): Promise<boolean> {
  const colorDoc = await CrossoverSheet.findById(colorId);
  const entry = colorDoc?.crossovers.id(crossoverId);
  if (!colorDoc || !entry) return false;
  entry.deleteOne();
  if (colorDoc.crossovers.length === 0) await CrossoverSheet.findByIdAndDelete(colorId);
  else await colorDoc.save();
  return true;
}

// ── products ──
export const listProducts = async (): Promise<Loose[]> => Product.find().sort({ id: -1 }).lean();
export const listProductNames = async (): Promise<Loose[]> =>
  Product.find().select('id name category collection availability image').lean().sort({ id: -1 });
export const getProduct = async (number: number): Promise<Loose | null> => Product.findOne({ id: number });
export async function saveProducts(prepared: { product: Loose; newProductId: string }[]): Promise<void> {
  const operations = prepared.map(({ product, newProductId }) => {
    const { _id, __v, ...productData } = product;
    if (productData.collection) { productData.collectionType = productData.collection; delete productData.collection; }
    return { updateOne: { filter: { id: product.id }, update: { $set: productData, $setOnInsert: { _id: newProductId } }, upsert: true } };
  });
  if (operations.length > 0) await Product.bulkWrite(operations);
}
/** The one-off "collection" → collectionType fill; returns how many it changed. */
export async function fillCollectionTypes(): Promise<number> {
  const products = await Product.find({});
  let updated = 0;
  for (const product of products) {
    const legacyCollection: unknown = product.get('collection');
    if (!product.collectionType && typeof legacyCollection === 'string' && legacyCollection) {
      product.collectionType = legacyCollection;
      await product.save();
      updated++;
    }
  }
  return updated;
}
