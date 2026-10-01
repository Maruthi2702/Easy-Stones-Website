import dotenv from 'dotenv';
dotenv.config();
// Trigger restart for schema update (v2)

import dns from 'dns';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

// Node's own DNS resolver (c-ares) mishandles a scoped/link-local IPv6
// nameserver (fe80::...%en0) — common on a phone hotspot or some routers'
// IPv6 RA setup — for SRV lookups specifically, failing with
// 'querySrv EBADRESP' and killing the mongodb+srv:// connection at boot,
// even though `dig`/the OS resolver handle the exact same query fine.
// Pointing Node at public resolvers sidesteps that host-network quirk
// entirely rather than depending on whatever nameserver DHCP handed out.
dns.setServers(['8.8.8.8', '1.1.1.1']);

// MOVED TO TOP to ensure settings apply to all models
mongoose.set('debug', process.env.NODE_ENV === 'development'); // Only log queries in development
mongoose.set('autoIndex', false);
// Removed bufferCommands: false to allow resilient reconnects

import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import Product from './src/models/Product.js';
import User from './src/models/User.js';
import Role from './src/models/Role.js';
import DailyReport from './src/models/DailyReport.js';
import Location from './src/models/Location.js';
import ContactSubmission from './src/models/ContactSubmission.js';
import Customer from './src/models/Customer.js';
import ImportMemory from './src/models/ImportMemory.js';
import CustomerMergeBackup from './src/models/CustomerMergeBackup.js';
import SalesResource from './src/models/SalesResource.js';
import SalesDashboardResource from './src/models/SalesDashboardResource.js';
import ActivityLog from './src/models/ActivityLog.js';
// Unified Model: Customer (now handles both Leads & Active Customers)
import LostSale from './src/models/LostSale.js';
import CrossoverSheet from './src/models/CrossoverSheet.js';
import EasyStonesColor from './src/models/EasyStonesColor.js';
import { EASY_STONES_COLORS } from './src/data/easyStonesColors.js';
import InventoryItem from './src/models/InventoryItem.js';
import InventorySalesRecord from './src/models/InventorySalesRecord.js';
// The one list of "every model that needs its indexes created on startup" —
// see its own comment for why this used to be two hand-maintained arrays
// (here and in ensure-indexes.js) that had already drifted apart.
import { INDEXED_MODELS } from './src/config/indexedModels.js';
import { SLAB_STATUS_BUCKET } from './src/utils/inventoryStatus.js';
import { sendContactFormEmail } from './src/services/emailService.js';
import { scrapeErpCustomers, scrapeErpInventory, scrapeErpSales } from './src/services/erpImportService.js';
// Shared with the client so an import can only assign a customer to someone the
// Sales Rep dropdown would also have offered.
import { isSalesRep } from './src/utils/salesReps.js';
import { geocodeAddress, geocodePatchFor, addressKeyOf, GEOCODE_PRECISION } from './src/utils/geocode.js';
// One definition of "these two records are the same business", shared by the
// import, the duplicate audit and the merge script.
import { groupDuplicates, STRONG, withoutSeparated } from './src/utils/customerMatch.js';
// Merging one customer into another, shared with scripts/merge-duplicate-customers.js.
import { planFields, contactsFromLosers, snapshotMerge, executeMerge, undoMerge, markSeparate } from './src/services/customerMerge.js';
// The customer import decides what it would do before it does any of it, in a
// module with no database access, so the whole decision can be exercised
// against a real spreadsheet without touching a record.
import {
  IMPORT_FIELDS, importNormalize, resolveImportMapping,
  buildImportPlan, importRowsForClient, importLabel,
  IMPORT_UNASSIGNED, IMPORT_DEFAULT_BRANCH
} from './src/utils/customerImport.js';
// The parsers themselves (parseInventoryStockWorkbook, parseInventorySalesWorkbook,
// readCustomerSheet) are no longer called directly here — every uploaded file goes
// through runWorkbookParse, which runs the real parse in a worker thread instead
// of on this process's own thread. See runWorkbookParse.js for why.
import { runWorkbookParse } from './src/utils/runWorkbookParse.js';
import createDailyReportsRouter from './src/routes/dailyReports.js';
import createDeliveriesRouter, { deliveryRoomFor, DELIVERY_ROOM_ALL } from './src/routes/deliveries.js';
import createCheckInRouter, { checkinRoomFor, CHECKIN_ROOM_ALL } from './src/routes/checkIn.js';
import createRoutePlannerFiltersRouter from './src/routes/routePlannerFilters.js';
import createGeocodeRouter from './src/routes/geocode.js';
import { startAutoSubmitDailyReports } from './src/jobs/autoSubmitDailyReports.js';
import { linkVisitToSchedule, unlinkVisitFromSchedule, moveVisitOnSchedule } from './src/services/visitSchedule.js';
import {
  getAggregationRangeMatch, getFollowUpRangeMatch, rangePrefilter, followUpDatePrefilter, slimForUnwind
} from './src/utils/dashboardMatch.js';
import createScheduleRouter, { createScheduleEmitter } from './src/routes/schedule.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mockup Generation Utility
const generateMockups = async (slabImageBuffer, baseFilename) => {
  const sharp = (await import('sharp')).default;
  const templatesDir = path.join(__dirname, 'public', 'images', 'templates');

  const templates = [
    { name: 'kitchen_template.png', suffix: 'installed_1' },
    { name: 'bathroom_template.png', suffix: 'installed_2' }
  ];

  const generatedUrls = [];

  for (const template of templates) {
    try {
      const templatePath = path.join(templatesDir, template.name);
      if (!fs.existsSync(templatePath)) {
        console.warn(`Template not found: ${templatePath}`);
        continue;
      }

      // Get template metadata
      const templateMetadata = await sharp(templatePath).metadata();

      // Resize slab to cover the template dimensions
      const slabBuffer = await sharp(slabImageBuffer)
        .resize(templateMetadata.width, templateMetadata.height, { fit: 'cover' })
        .toBuffer();

      // Composite
      const compositeBuffer = await sharp(templatePath)
        .composite([{
          input: slabBuffer,
          blend: 'overlay', // Using overlay to keep shadows/details
          gravity: 'center'
        }])
        .png()
        .toBuffer();

      // Upload to Cloudinary
      const outputFilename = `${template.suffix}_${baseFilename}`;
      const result = await uploadToCloudinary(compositeBuffer, 'products/installed', outputFilename);

      generatedUrls.push(result.secure_url);

    } catch (err) {
      console.error(`Failed to generate/upload mockup for ${template.name}:`, err);
    }
  }

  return generatedUrls;
};

// Image Optimization Utility
const optimizeImage = async (buffer) => {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buffer)
      .resize(1200, 1200, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    console.error('Sharp optimization failed, using original buffer:', err);
    return buffer;
  }
};

// Simple Memory Cache for Products (Cache for 10 minutes)
const memoryCache = {
  products: { data: null, lastFetched: 0 },
  // The staff directory and the customer dropdown are read on nearly every page
  // load but change rarely. The dropdown in particular is expensive out of all
  // proportion to its size: customer documents average tens of KB, so building a
  // 100KB list means reading tens of MB. Serve both from memory between changes.
  salesreps: { data: null, lastFetched: 0 },
  customerDropdown: { data: null, lastFetched: 0 },
  // Same reasoning as the dropdown, more so: the map's source documents carry
  // the visit logs, so building it uncached reads the heaviest field we hold.
  customerMap: { data: null, lastFetched: 0 },
  TTL: 10 * 60 * 1000
};

const cacheHit = (key) =>
  memoryCache[key].data && (Date.now() - memoryCache[key].lastFetched) < memoryCache.TTL
    ? memoryCache[key].data
    : null;

const cachePut = (key, data) => {
  memoryCache[key].data = data;
  memoryCache[key].lastFetched = Date.now();
  return data;
};

// Helper to bust the product cache after any write
const bustProductCache = () => {
  memoryCache.products.data = null;
  memoryCache.products.lastFetched = 0;
  console.log('🗑️ Product cache invalidated');
};

// Customer writes change both the dropdown and, via role edits, the staff list.
const bustCustomerCaches = () => {
  memoryCache.customerDropdown.data = null;
  memoryCache.customerDropdown.lastFetched = 0;
  memoryCache.customerMap.data = null;
  memoryCache.customerMap.lastFetched = 0;
};

const bustUserCaches = () => {
  memoryCache.salesreps.data = null;
  memoryCache.salesreps.lastFetched = 0;
};

// Base64 to Cloudinary Upload Utility (persistent across restarts)
// Falls back to disk only if Cloudinary is not configured (local dev without .env)
// A PDF attached to a visit: uploaded as a Cloudinary raw file named *.pdf (so
// isPdfSource in src/utils/attachments.js recognises the URL), the same file
// type delivery packing lists use. These used to fall through
// processBase64Image's image-only check and stay inline in the customer
// document — 6 of them, up to 269 KB each, by Feb 2026. Without Cloudinary, or
// if the upload fails, it stays inline as before rather than being lost.
const processBase64Pdf = async (dataUrl, subDir) => {
  if (!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)) {
    return dataUrl;
  }
  try {
    const buffer = Buffer.from(dataUrl.split(';base64,').pop(), 'base64');
    const publicId = `pdf_${Date.now()}_${Math.round(Math.random() * 1E9)}.pdf`;
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: subDir, public_id: publicId, resource_type: 'raw' },
        (error, res) => (error ? reject(error) : resolve(res))
      ).end(buffer);
    });
    return result.secure_url;
  } catch (err) {
    console.error('Failed to upload PDF attachment:', err);
    return dataUrl;
  }
};

const processBase64Image = async (base64String, subDir = 'Visits') => {
  if (typeof base64String === 'string' && base64String.startsWith('data:application/pdf')) {
    return processBase64Pdf(base64String, subDir);
  }
  if (!base64String || !base64String.startsWith('data:image/')) return base64String;

  try {
    const sharp = (await import('sharp')).default;
    const base64Data = base64String.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');

    // Optimize with sharp before uploading
    const optimizedBuffer = await sharp(buffer)
      .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75, effort: 2 })
      .toBuffer();

    // Upload to Cloudinary if configured (persistent — survives Render restarts)
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: subDir, public_id: `img_${uniqueSuffix}`, resource_type: 'image' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(optimizedBuffer);
      });
      return result.secure_url;
    }

    // Fallback: save to disk (local dev only — not suitable for Render/cloud)
    console.warn('⚠️ Cloudinary not configured — saving visit image to disk (will be lost on restart)');
    const uploadDir = path.join(__dirname, 'public/uploads', subDir);
    if (!fs.existsSync(uploadDir)) {
      await fs.promises.mkdir(uploadDir, { recursive: true });
    }

    const filename = `img_${Date.now()}_${Math.round(Math.random() * 1E9)}.webp`;
    const filePath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filePath, optimizedBuffer);

    return `/uploads/${subDir}/${filename}`;
  } catch (err) {
    console.error('Failed to process base64 image:', err);
    return base64String;
  }
};

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true
  }
});
app.set('io', io);

// Shared by every join_*_rooms handler below: proves who a socket belongs to
// so the server can join it to the room(s) for its actual assigned
// location(s), for channels (delivery_update, checkin_update) that carry
// per-branch data and so aren't broadcast to every connected socket the way
// other channels on the same connection are. Kept in one place so the two
// handlers can't drift on validation rules (e.g. rejecting customer-type
// tokens) the way two independent copies eventually would. Returns null on
// any failure — invalid/expired token, unknown user — rather than throwing,
// so the caller just leaves that socket out of every room for that feature.
async function resolveSocketAssignedLocations(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const userId = decoded.userId || decoded.id || decoded.sub;
  if (!userId || decoded.type === 'customer' || !mongoose.isValidObjectId(userId)) return null;
  const user = await User.findById(userId, 'assignedLocations').lean();
  return user ? (user.assignedLocations || []) : null;
}

io.on('connection', (socket) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔌 WebSockets: Client connected (${socket.id})`);
  }

  // The connection itself stays open with no auth requirement — other
  // channels on this same socket (crossover_sheet_update, inventory_analysis
  // _update, etc.) aren't location-scoped and don't need it. Delivery and
  // check-in data are different: they carry customer names, addresses/phone
  // numbers and (for deliveries) pricing per branch, so a socket only joins
  // a branch's room once it proves who it is. A socket that never calls
  // these (or whose token fails) simply never joins that feature's rooms and
  // never receives its update event — it isn't disconnected, since it may
  // still legitimately use other channels.
  socket.on('join_delivery_rooms', async (payload) => {
    try {
      const assignedLocations = await resolveSocketAssignedLocations(payload?.token);
      if (!assignedLocations) return;
      if (assignedLocations.includes('*')) {
        socket.join(DELIVERY_ROOM_ALL);
      } else {
        for (const location of assignedLocations) socket.join(deliveryRoomFor(location));
      }
    } catch {
      // Invalid/expired token — leave the socket out of every delivery room
      // rather than erroring the whole connection.
    }
  });

  socket.on('join_checkin_rooms', async (payload) => {
    try {
      const assignedLocations = await resolveSocketAssignedLocations(payload?.token);
      if (!assignedLocations) return;
      if (assignedLocations.includes('*')) {
        socket.join(CHECKIN_ROOM_ALL);
      } else {
        for (const location of assignedLocations) socket.join(checkinRoomFor(location));
      }
    } catch {
      // Invalid/expired token — leave the socket out of every check-in room
      // rather than erroring the whole connection.
    }
  });

  socket.on('disconnect', () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔌 WebSockets: Client disconnected (${socket.id})`);
    }
  });
});

const PORT = process.env.PORT || 3001;

// JWT Secret — fails closed. This used to fall back to a fixed string
// ('your-secret-key-change-in-production') checked straight into source
// control, so an environment that simply forgot to set JWT_SECRET didn't
// break loudly — it quietly started signing and accepting tokens with a
// secret anyone could read on GitHub, meaning anyone could forge a valid
// login for any account. Refusing to start is the correct failure mode for
// a secret this central; a silently-insecure server is worse than a server
// that won't come up.
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Every login token this app issues is signed with ' +
    'it — refusing to start rather than fall back to an insecure default. Set ' +
    'JWT_SECRET in .env (see .env.example).'
  );
}
const JWT_SECRET = process.env.JWT_SECRET;

// Neutralise regex metacharacters before interpolating user input into a RegExp.
// Without this a search for "(" throws, and a crafted pattern can pin the CPU.
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mongoOptions = {
  serverSelectionTimeoutMS: 15000, // Increased from 5000 for cold-start resilience
  socketTimeoutMS: 45000,
  connectTimeoutMS: 15000, // Increased from 10000
  maxPoolSize: 10,
  family: 4, // Force IPv4 to avoid potential dual-stack networking issues
};

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB runtime error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnecting', () => {
  console.log('🔄 MongoDB reconnecting...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('fullsetup', () => {
  console.log('🌐 MongoDB connection: All nodes in replica set reachable');
});

// GLOBAL ERROR HANDLERS
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Give time for logs to flush before exiting if needed
  setTimeout(() => process.exit(1), 1000);
});

// STARTUP WRAPPER
async function startServer() {
  console.log(`📡 Connecting to MongoDB Atlas (Wait for Ready)...`);
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', mongoOptions);
    console.log('✅ Connected to MongoDB Atlas');
    console.log('Connection Ready State:', mongoose.connection.readyState);

    // Ensure all database indexes are created/synced for performance scalability.
    // autoIndex is disabled on the connection, so a model missing from
    // INDEXED_MODELS silently runs with no indexes at all — see the comment on
    // that list (src/config/indexedModels.js) for the incident history and why
    // it is the one place this gets maintained now, instead of here and in
    // ensure-indexes.js separately.
    // Settled individually so one model's failure (e.g. a pre-existing index with
    // conflicting options) can't mask or abort the rest.
    console.log('🔨 Syncing database indexes for scalability...');
    const indexResults = await Promise.allSettled(
      INDEXED_MODELS.map(([, model]) => model.createIndexes())
    );
    indexResults.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`⚠️ Index sync failed for ${INDEXED_MODELS[i][0]}: ${result.reason?.message || result.reason}`);
      }
    });
    if (indexResults.every(r => r.status === 'fulfilled')) {
      console.log('✅ Database indexes synchronized successfully');
    } else {
      console.log(`✅ Index sync complete (${indexResults.filter(r => r.status === 'fulfilled').length}/${INDEXED_MODELS.length} models OK)`);
    }

    // Database migration: Initialize assignedLocations for existing users & upgrade admins to global
    try {
      const updateUsersResult = await User.updateMany(
        { assignedLocations: { $exists: false } },
        { $set: { assignedLocations: ['Seattle'] } }
      );
      if (updateUsersResult.modifiedCount > 0) {
        console.log(`🔄 Initialized assignedLocations for ${updateUsersResult.modifiedCount} users`);
      }
      const updateAdminsResult = await User.updateMany(
        { role: 'admin', assignedLocations: { $ne: '*' } },
        { $set: { assignedLocations: ['*'] } }
      );
      if (updateAdminsResult.modifiedCount > 0) {
        console.log(`🔄 Upgraded ${updateAdminsResult.modifiedCount} administrators to global location access`);
      }
    } catch (migError) {
      console.error('Error running user locations migration:', migError);
    }

    // Database migration: assign every pre-existing customer to Seattle.
    // The schema default only applies to documents created after it, so without
    // this the records imported before the branch field existed would carry no
    // location at all and drop out of every branch filter. Only fills records
    // that have none, so it is a no-op on every boot after the first and can
    // never overwrite a branch a rep has chosen.
    //
    // salesRep is deliberately left unset. Only a fraction of these records
    // carry a createdBy, and "whoever typed it in" is not the same fact as "who
    // owns the account" — a guess would put a wrong name on hundreds of records
    // nobody would think to check. They read as Unassigned until someone says
    // otherwise, which is what makes the Unassigned filter worth having.
    try {
      const seededLocations = await Customer.updateMany(
        { $or: [{ location: { $exists: false } }, { location: null }, { location: '' }] },
        { $set: { location: 'Seattle' } }
      );
      if (seededLocations.modifiedCount > 0) {
        console.log(`🔄 Assigned ${seededLocations.modifiedCount} customers to the Seattle branch`);
      }
    } catch (migError) {
      console.error('Error running customer location migration:', migError);
    }

    // Database seeding: Default Locations
    try {
      const locationCount = await Location.countDocuments();
      if (locationCount === 0) {
        const defaultLocs = [
          { name: 'Seattle' },
          { name: 'Spokane' },
          { name: 'Salt Lake City' }
        ];
        await Location.insertMany(defaultLocs);
        console.log('✅ Default locations seeded successfully');
      }
    } catch (locError) {
      console.error('Error seeding default locations:', locError);
    }

    // Database seeding: Easy Stones color catalog (one-time migration off the
    // hardcoded EASY_STONES_COLORS array — see src/data/easyStonesColors.js).
    // Only runs while the collection is empty, so it can't clobber colors an
    // admin has since added, renamed, or removed via the Crossover Sheet's
    // manage-colors UI.
    try {
      const colorCount = await EasyStonesColor.countDocuments();
      if (colorCount === 0) {
        await EasyStonesColor.insertMany(
          EASY_STONES_COLORS.map((name, index) => ({ name, order: index }))
        );
        console.log('✅ Easy Stones color catalog seeded successfully');
      }
    } catch (colorError) {
      console.error('Error seeding Easy Stones color catalog:', colorError);
    }
    // Kiosk users are managed dynamically by the administrator via the dashboard, no auto-seeding required.
    // Seed standard Roles & Permissions
    try {
      const defaultRoles = [
        {
          name: 'admin',
          displayName: 'Administrator',
          permissions: [
            'view_dashboard', 'view_customers', 'manage_customers', 'delete_customers',
            'manage_customer_accounts',
            'view_checkins', 'manage_checkins', 'delete_checkins', 'send_checkin_email',
            'view_pricelist', 'manage_pricelist', 'manage_users', 'view_product_prices',
            'view_lost_sales', 'edit_lost_sales', 'delete_lost_sales',
            'view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report',
            'view_crossover_sheet', 'add_crossover_sheet', 'edit_crossover_sheet', 'delete_crossover_sheet',
            'manage_easy_stones_colors',
            'view_inventory_analysis', 'import_inventory_analysis', 'view_inventory_prices',
            'view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures'
          ],
          isSystem: true
        },
        {
          name: 'director',
          displayName: 'Director',
          permissions: [
            'view_dashboard', 'view_customers', 'manage_customers', 'delete_customers',
            'manage_customer_accounts',
            'view_checkins', 'manage_checkins', 'delete_checkins', 'send_checkin_email',
            'view_pricelist', 'manage_pricelist', 'manage_users', 'view_product_prices',
            'view_lost_sales', 'edit_lost_sales', 'delete_lost_sales',
            'view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report',
            'view_crossover_sheet', 'add_crossover_sheet', 'edit_crossover_sheet', 'delete_crossover_sheet',
            'manage_easy_stones_colors',
            'view_inventory_analysis', 'import_inventory_analysis', 'view_inventory_prices',
            'view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures'
          ],
          isSystem: true
        },
        {
          name: 'manager',
          displayName: 'Manager',
          permissions: [
            'view_dashboard', 'view_customers', 'manage_customers',
            'view_checkins', 'manage_checkins', 'send_checkin_email', 'delete_checkins',
            'view_pricelist', 'manage_users', 'view_product_prices',
            'view_lost_sales', 'edit_lost_sales', 'delete_lost_sales',
            'view_daily_report', 'edit_daily_report', 'submit_daily_report',
            'view_crossover_sheet', 'add_crossover_sheet', 'edit_crossover_sheet', 'delete_crossover_sheet',
            'view_inventory_analysis', 'import_inventory_analysis',
            'view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures'
          ],
          isSystem: true
        },
        {
          name: 'sales_rep',
          displayName: 'Sales Representative',
          permissions: [
            'view_dashboard', 'view_customers', 'manage_customers',
            'view_checkins', 'manage_checkins', 'send_checkin_email',
            'view_pricelist', 'manage_users', 'view_product_prices',
            'view_lost_sales', 'edit_lost_sales',
            'view_crossover_sheet', 'add_crossover_sheet', 'edit_crossover_sheet',
            'view_inventory_analysis',
            'view_delivery_schedule', 'edit_delivery_schedule'
          ],
          isSystem: true
        },
        {
          name: 'csr',
          displayName: 'CSR',
          permissions: [
            'view_checkins', 'manage_checkins', 'send_checkin_email', 'view_pricelist',
            'view_lost_sales', 'view_crossover_sheet', 'view_inventory_analysis',
            'view_delivery_schedule', 'edit_delivery_schedule'
          ],
          isSystem: true
        },
        {
          name: 'driver',
          displayName: 'Driver / Logistics',
          permissions: [
            'view_delivery_schedule'
          ],
          isSystem: true
        }
      ];

      for (const roleDef of defaultRoles) {
        // Only seed/create the role if it doesn't already exist.
        const existing = await Role.findOne({ name: roleDef.name });
        if (!existing) {
          const created = await Role.create(roleDef);
          console.log(`🌱 Seeded standard role: ${created.name} → [${created.permissions.join(', ')}]`);
        } else {
          console.log(`ℹ️ System role '${roleDef.name}' already exists, skipping seed override to preserve custom permissions`);
        }
      }

      // New feature permissions reach existing installations here. The seed above
      // deliberately never overwrites a role, so a permission added after a role
      // was created would otherwise exist for nobody — including administrators,
      // who hold every other permission by definition. Only admin and director
      // are topped up; the rest are for you to assign under Users & Roles.
      const NEW_PERMISSION_GRANTS = [
        { roles: ['admin', 'director'], permissions: ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'] },
        // Route planner: administrators only, deliberately. It reads every
        // account's location and writes days into a calendar, so who gets it is
        // a decision to make deliberately under Users & Roles rather than one
        // that arrives switched on for a whole role.
        { roles: ['admin'], permissions: ['view_route_planner', 'create_route_plan', 'edit_route_plan', 'delete_route_plan'] },
        { roles: ['admin', 'director', 'manager'], permissions: ['view_crossover_sheet', 'add_crossover_sheet', 'edit_crossover_sheet', 'delete_crossover_sheet'] },
        { roles: ['sales_rep'], permissions: ['view_crossover_sheet', 'add_crossover_sheet', 'edit_crossover_sheet'] },
        { roles: ['csr'], permissions: ['view_crossover_sheet'] },
        // Was hardcoded to role === 'admin' || 'director' in the route
        // handlers; moved to a real permission so it can be granted to
        // other roles (e.g. manager) under Users & Roles without making
        // them a full admin/director. Defaults preserve today's behavior.
        { roles: ['admin', 'director'], permissions: ['manage_easy_stones_colors'] },
        { roles: ['admin', 'director', 'manager'], permissions: ['view_inventory_analysis', 'import_inventory_analysis'] },
        { roles: ['sales_rep', 'csr'], permissions: ['view_inventory_analysis'] },
        // Slab/lot cost and asset-value figures are a separate, narrower grant
        // from seeing the Inventory Analysis page itself — default to admin
        // and director only; assign it to other roles under Users & Roles.
        { roles: ['admin', 'director'], permissions: ['view_inventory_prices'] },
        // Delivery Schedule permissions were seeded backwards on existing
        // installs — admin/director/manager/sales_rep/csr had none of them
        // while driver held them — see src/components/sales/delivery/README.md's
        // "Permission model" section for the intended split this corrects.
        { roles: ['admin', 'director', 'manager', 'sales_rep', 'csr'], permissions: ['view_delivery_schedule', 'edit_delivery_schedule'] },
        { roles: ['admin', 'director', 'manager'], permissions: ['delete_delivery_schedule', 'clear_pod_signatures'] },
        // PUT /api/checkin/:id used to accept view_checkins OR manage_checkins,
        // so "View" silently granted edit too. Now that it requires
        // manage_checkins outright, csr (which only had view_checkins) needs
        // it granted explicitly to keep editing selection sheets as before.
        { roles: ['csr'], permissions: ['manage_checkins'] },
        // Account & Security actions (password reset, activate/deactivate)
        // moved from the Admin panel's Customers tab into the Sales CRM's
        // customer info panel. Narrower than manage_customers on purpose —
        // every sales rep can already edit CRM fields, but only admin/director
        // get to touch login/lockout state or force a password reset.
        { roles: ['admin', 'director'], permissions: ['manage_customer_accounts'] }
      ];

      for (const grant of NEW_PERMISSION_GRANTS) {
        for (const roleName of grant.roles) {
          const role = await Role.findOne({ name: roleName });
          if (!role) continue;
          const missing = grant.permissions.filter(p => !role.permissions.includes(p));
          if (missing.length === 0) continue;
          role.permissions.push(...missing);
          await role.save();
          console.log(`🔑 Granted ${roleName}: ${missing.join(', ')}`);
        }
      }

      // manage_delivery_schedule was an orphaned permission: seeded onto the
      // driver role, checked by two frontend files, but never exposed as a
      // toggle in Users & Roles and never checked by any backend route.
      // Superseded entirely by view_delivery_schedule/edit_delivery_schedule —
      // strip it from any role (existing installs) that still has it.
      const rolesWithStalePerm = await Role.find({ permissions: 'manage_delivery_schedule' });
      for (const role of rolesWithStalePerm) {
        role.permissions = role.permissions.filter(p => p !== 'manage_delivery_schedule');
        await role.save();
        console.log(`🧹 Removed orphaned permission 'manage_delivery_schedule' from role '${role.name}'`);
      }

      // Seed default driver account if no driver user exists yet
      const existingDriver = await User.findOne({ role: 'driver' });
      if (!existingDriver) {
        const defaultDriver = new User({
          username: 'driver',
          password: 'driver123',
          email: 'driver@easystones.com',
          role: 'driver',
          location: 'Seattle',
          assignedLocations: ['*']
        });
        await defaultDriver.save();
        console.log('🚚 Seeded default driver account: username "driver", password "driver123"');
      }

      // Seed driver account for Sergio
      const existingSergio = await User.findOne({ username: 'sergio' });
      if (!existingSergio) {
        const sergioUser = new User({
          username: 'sergio',
          password: 'sergio123',
          email: 'sergio@easystones.com',
          role: 'driver',
          location: 'Seattle',
          assignedLocations: ['*']
        });
        await sergioUser.save();
        console.log('🚚 Seeded driver account for Sergio: username "sergio", password "sergio123"');
      }
    } catch (seedRoleErr) {
      console.error('Error seeding roles:', seedRoleErr);
    }

    // Database migration: Copy legacy email to marketingEmail if not exists, and set receiveMarketing default to true
    try {
      const unmigrated = await Customer.find({ marketingEmail: { $exists: false } });
      if (unmigrated.length > 0) {
        console.log(`🔄 Migrating ${unmigrated.length} customers to initialize marketingEmail and receiveMarketing...`);
        let count = 0;
        for (const doc of unmigrated) {
          doc.marketingEmail = doc.email;
          doc.receiveMarketing = true;
          // Use save() bypass validation for fast execution since they are existing records
          await Customer.updateOne(
            { _id: doc._id },
            { $set: { marketingEmail: doc.email, receiveMarketing: true } }
          );
          count++;
        }
        console.log(`✅ Successfully initialized marketing fields for ${count} customers.`);
      }
    } catch (migError) {
      console.error('Error running marketing email migration:', migError);
    }

    httpServer.listen(PORT, () => {
      console.log(`🚀 Backend server running on port ${PORT}`);

      // A day nobody signed off is closed out at 11:59 PM on the branch's own
      // clock, so the figures stop being editable once the day is over.
      startAutoSubmitDailyReports();

      // Keep-Alive Mechanism for Render Free Tier
      const keepAliveInterval = 5 * 60 * 1000;
      setInterval(() => {
        const url = process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL || `http://localhost:${PORT}`;
        const healthUrl = `${url}/api/health`;
        fetch(healthUrl)
          .then(res => console.log(`✅ Keep-alive ping: ${res.status}`))
          .catch(err => console.error(`❌ Keep-alive failed: ${err.message}`));
      }, keepAliveInterval);
    });
  } catch (err) {
    console.error('❌ MongoDB initial connection fatal error:', err);
    process.exit(1);
  }
}

startServer();

// Cloudinary config removed - using local storage
// Cloudinary config removed - using local storage
const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({
  storage: memoryStorage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit for memory uploads (Excel bulk, etc.)
});

const uploadResources = multer({ storage: memoryStorage, limits: { fileSize: 200 * 1024 * 1024 } });

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  process.env.FRONTEND_URL,
  'https://maruthi2702.github.io' // Allow GitHub Pages
].filter(Boolean);

// Trust proxy - required for rate limiting behind proxies (Render, Vercel, etc.)
app.set('trust proxy', 1);

app.use(cors({
  origin: function (origin, callback) {
    // No Origin header means a same-origin request, curl, or a server-to-server
    // call — none of which a browser CORS check ever applies to.
    if (!origin) return callback(null, true);
    // credentials: true means a page on any origin that was reflected here could
    // call this API as whoever's cookie the visitor's browser was holding.
    // allowedOrigins is our own domains plus FRONTEND_URL; anything else is
    // refused rather than reflected.
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // false, not an Error: an Error here has no handler downstream and falls
    // through to Express's default page, which dumps a stack trace — full file
    // paths — to whoever sent the disallowed origin. false makes the cors
    // package skip the Access-Control-Allow-Origin header and move on, which is
    // all a browser needs to block the response; nothing else has to reject it.
    return callback(null, false);
  },
  credentials: true // Allow cookies
}));

// Compression middleware - reduces response sizes by 70-90%
app.use(compression());

app.use(express.json({ limit: '200mb' })); // Increase limit for large payloads (multiple images)
app.use(cookieParser());

// A backstop for the other 130+ routes, which had no rate limiting of any
// kind before this — only /api/auth/login and /api/customer/login did.
// Deliberately generous (loginLimiter's own "Increased limit for debugging"
// comment is a reminder that a limiter tuned too tight just becomes a
// support ticket for real staff on a shared office IP) — this exists to stop
// a client hammering the API, not to police normal multi-user traffic.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' }
});
app.use('/api', apiLimiter);

// Prevent caching for all API routes to ensure fresh data after logout/login
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Invalidate the cached staff and customer lists after any successful write to
// the collections they are built from. Doing it here rather than in each handler
// means a new route cannot forget to, and serving a stale dropdown for ten
// minutes after adding a customer would be worse than the query it saves.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  // originalUrl, not req.path: inside a mounted middleware req.path is relative
  // to the mount point, and Express has restored req.url by the time 'finish'
  // fires — reading it there matched nothing and left the caches stale.
  const url = req.originalUrl || '';
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    if (url.startsWith('/api/customers') || url.startsWith('/api/partners') || url.startsWith('/api/admin/customers')) {
      bustCustomerCaches();
    }
    if (url.startsWith('/api/admin/users') || url.startsWith('/api/admin/roles') || url.startsWith('/api/auth/change-password')) {
      bustUserCaches();
    }
  });
  next();
});

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased limit for debugging
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API endpoint to fetch all products
app.get('/api/products', async (req, res) => {
  try {
    const now = Date.now();
    let products;

    // Check Cache
    if (memoryCache.products.data && (now - memoryCache.products.lastFetched < memoryCache.TTL)) {
      products = memoryCache.products.data;
    } else {
      // Fetch fresh and update cache
      products = await Product.find().sort({ id: -1 }).lean();
      console.log('📦 GET /api/products fetched from DB. Count:', products.length);
      const withBundles = products.filter(p => p.bundles && p.bundles.length > 0);
      console.log('📦 Products with bundles:', withBundles.length);
      if (withBundles.length > 0) {
        console.log('📦 Sample products with bundles:', withBundles.slice(0, 3).map(p => ({ name: p.name, bundlesCount: p.bundles.length })));
      }
      memoryCache.products.data = products;
      memoryCache.products.lastFetched = now;
      console.log('✅ Products Cache Refreshed');
    }

    // Check if customer is logged in
    const token = req.cookies.customerToken;
    let priceLevel = 1; // Default to level 1

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type === 'customer') {
          // Optimized: Only fetch priceLevel
          const customer = await Customer.findById(decoded.id).select('priceLevel').lean();
          if (customer && customer.priceLevel) {
            priceLevel = customer.priceLevel;
          }
        }
      } catch {
        // Token invalid or expired, use default level 1
      }
    }

    // Transform products to show price based on customer's level
    const productsWithPrices = products.map(product => {
      // Product is already a lean object from cache/db
      const productObj = { ...product };

      if (productObj.priceLevels) {
        const levelKey = `level${priceLevel}`;
        const levelPrice = productObj.priceLevels[levelKey];

        if (levelPrice) {
          productObj.price = `$${levelPrice.toFixed(2)}/sqft`;
        }
      }

      return productObj;
    });

    res.json(productsWithPrices);
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/**
 * Usernames are login identifiers and are stored lower-case so signing in is
 * not case-sensitive. Nothing user-facing should render one directly — use
 * displayNameOf(), which prefers the Display Name the user set for themselves
 * and falls back to a tidied-up username for accounts that have not set one.
 *
 *   { username: 'jonathan',            displayName: '' }         → 'Jonathan'
 *   { username: '3rd party - delivery', displayName: '' }        → '3rd Party Delivery'
 *   { username: '3rd party - delivery', displayName: '3rd Party - Delivery' }
 *                                                                → '3rd Party - Delivery'
 */
const prettifyUsername = (username = '') =>
  String(username)
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const displayNameOf = (user) =>
  String(user?.displayName || '').trim() || prettifyUsername(user?.username);

/**
 * Resolve a customer's owning rep from an id into the { salesRep, salesRepName }
 * pair the record stores. The name is derived here rather than accepted from the
 * client so the cached label can never disagree with the account it points at.
 * An empty or unknown id clears both — that is how an account is handed back.
 */
const resolveSalesRep = async (salesRepId) => {
  if (!salesRepId) return { salesRep: null, salesRepName: '' };

  if (!mongoose.Types.ObjectId.isValid(salesRepId)) {
    return { salesRep: null, salesRepName: '' };
  }

  const rep = await User.findById(salesRepId).select('username displayName').lean();
  return rep
    ? { salesRep: rep._id, salesRepName: displayNameOf(rep) }
    : { salesRep: null, salesRepName: '' };
};

// =============================================================================
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// DB-first design: JWT proves identity only. Role + permissions always fetched
// live from MongoDB, so changes take effect immediately without re-login.
// =============================================================================

/**
 * authenticate — unified middleware for all protected routes.
 *
 * Accepts tokens from:
 *   - Cookie: adminToken (staff via /api/auth/login)
 *   - Cookie: customerToken (customer/internal via unified login)
 *   - Header: Authorization: Bearer <token>
 *
 * Sets on req:
 *   req.user      = { id, username, email, role, permissions[], type }
 *   req.userId    = user._id          (legacy compat)
 *   req.userRole  = user.role         (legacy compat)
 *   req.authType  = 'admin'|'customer'(legacy compat)
 *   req.customerId = id               (for customer routes)
 */
const authenticate = async (req, res, next) => {
  // 1. Extract token — accept any source
  const token = req.cookies.adminToken
    || req.cookies.customerToken
    || (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization !== 'Bearer null'
        ? req.headers.authorization.slice(7) : null);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  // 2. Verify JWT signature and expiry ONLY — do NOT trust any payload fields for authorisation
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  // 3. Determine user type from token payload
  const tokenType = decoded.type || (decoded.userId ? 'admin' : null);
  const userId = decoded.userId || decoded.id || decoded.sub;

  if (!userId) {
    return res.status(401).json({ error: 'Malformed token. Please log in again.' });
  }

  try {
    if (tokenType === 'customer') {
      // ── Customer access ─────────────────────────────────────────────────────
      // Customers have no CRM permissions — just identify them
      req.user = { id: userId, type: 'customer', role: 'customer', permissions: [] };
      req.customerId = userId;
      req.authType = 'customer';
      return next();
    }

    // ── Staff / internal access ──────────────────────────────────────────────
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(401).json({ error: 'Malformed token. Please log in again.' });
    }

    // ALWAYS read the user AND the role's permissions from the DB — never trust
    // anything in the JWT. This used to be two awaits (findById, then findOne on
    // the role name it returned), which meant two sequential Atlas round trips on
    // EVERY authenticated request. Joining them server-side halves that: same
    // freshness, same result, one trip.
    const [dbUser] = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(userId) } },
      { $limit: 1 },
      // Role.name is stored trimmed + lower-cased by its schema setters, and
      // Role.findOne() used to apply those setters to the query for us.
      // Aggregation does no casting, so normalise the key explicitly.
      { $addFields: { _roleKey: { $toLower: { $trim: { input: { $ifNull: ['$role', ''] } } } } } },
      {
        $lookup: {
          from: Role.collection.name,
          localField: '_roleKey',
          foreignField: 'name',   // unique index — this is an indexed join
          as: '_role'
        }
      },
      // Named fields only: keeps the password hash and the stored Google/iCloud
      // tokens out of the auth payload entirely.
      {
        $project: {
          username: 1,
          displayName: 1,
          email: 1,
          role: 1,
          assignedLocations: 1,
          permissions: { $ifNull: [{ $arrayElemAt: ['$_role.permissions', 0] }, []] }
        }
      }
    ]);

    if (!dbUser) {
      return res.status(401).json({ error: 'User account not found or has been removed.' });
    }

    // Populate req.user with fresh data
    req.user = {
      id: dbUser._id,
      username: dbUser.username,          // login identifier — do not render
      displayName: displayNameOf(dbUser), // render this instead
      email: dbUser.email,
      role: dbUser.role,
      permissions: dbUser.permissions,   // always fresh from DB
      assignedLocations: dbUser.assignedLocations || ['Seattle'],
      type: 'staff'
    };

    // Legacy compatibility fields used by existing route handlers
    req.userId   = dbUser._id;
    req.userRole = dbUser.role;
    req.authType = 'admin';

    // Also set customerId for routes that check both (e.g. visit reactions)
    if (tokenType === 'internal') {
      req.customerId = userId;
      req.accountType = 'internal';
    }

    next();
  } catch (err) {
    console.error('❌ authenticate DB lookup failed:', err);
    res.status(500).json({ error: 'Authentication check failed. Please try again.' });
  }
};

/**
 * requirePermission — authorisation guard for protected routes.
 *
 * Must run AFTER authenticate (relies on req.user.permissions).
 * Accepts one or more permission strings — user must have ALL of them.
 *
 * Usage:
 *   app.get('/api/admin/users', authenticate, requirePermission('manage_users'), handler)
 *   app.post('/api/admin/data', authenticate, requirePermission('manage_customers', 'view_dashboard'), handler)
 */
const requirePermission = (...permissions) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  const missing = permissions.find(p => !req.user.permissions.includes(p));
  if (missing) {
    return res.status(403).json({
      error: `Access denied. Your role ("${req.user.role}") does not have the "${missing}" permission.`
    });
  }

  next();
};

const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  const userPerms = req.user.permissions || [];
  const hasAny = permissions.some(p => userPerms.includes(p));
  if (!hasAny) {
    return res.status(403).json({
      error: `Access denied. Your role ("${req.user.role}") requires at least one of these permissions: ${permissions.join(', ')}.`
    });
  }

  next();
};

// Legacy aliases — kept so any remaining code using old names still works
// during the transition. These will be removed in a future cleanup.
const verifyToken    = authenticate;
const verifyAnyAuth  = authenticate;
const checkPermission = (permission) => requirePermission(permission);
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Insufficient role.' });
  }
  next();
};

// Was reachable with no auth at all — literally anyone could hit it. Beyond
// leaking the connected DB host/name, ?username= turned it into a
// username-enumeration + account-lockout oracle: exactly the reconnaissance a
// credential-stuffing attempt wants before it starts. Moved down here (it used
// to sit right after startServer(), near the top of the file) because
// verifyToken/authorize don't exist yet at that point in a top-to-bottom
// script — referencing them there throws at startup, not at request time.
app.get('/api/debug/config', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const adminCount = await User.countDocuments();
    const dbName = mongoose.connection.name;
    const host = mongoose.connection.host;

    // Check for specific user if provided
    let userCheck = null;
    if (req.query.username) {
      const user = await User.findOne({ username: req.query.username.toLowerCase() });
      userCheck = {
        requested_username: req.query.username,
        found: !!user,
        login_attempts: user ? user.loginAttempts : null,
        is_locked: user ? user.isLocked() : null
      };
    }

    res.json({
      connected_db: dbName,
      host: host,
      admin_count: adminCount,
      mongo_uri_masked: process.env.MONGO_URI ? process.env.MONGO_URI.split('@')[1] : 'not_set',
      user_check: userCheck
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Enhanced authentication endpoint with bcrypt and JWT
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Find user by username
    console.log(`🔍 Attempting to find User (Admin): ${username} (ReadyState: ${mongoose.connection.readyState})`);
    const startQuery = Date.now();
    const user = await User.findOne({ username: username.toLowerCase() });
    console.log(`⏱️ Query took ${Date.now() - startQuery}ms`);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account locked due to too many failed attempts. Try again in 15 minutes.'
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      // Increment login attempts
      await user.incLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // Generate JWT — identity only, NO role stored in token
    // Role is always fetched live from DB by the authenticate middleware
    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username
        // role intentionally omitted — DB is the source of truth
      },
      JWT_SECRET,
      { expiresIn: '6h' }
    );

    // Set HTTP-only cookie
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 6 * 60 * 60 * 1000 // 6 hours
    });

    const dbRole = await Role.findOne({ name: user.role });
    const permissions = dbRole?.permissions || [];

    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        username: user.username,
        displayName: user.displayName || '',
        name: displayNameOf(user),
        email: user.email,
        role: user.role,
        permissions
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Token exchange - returns the token from the cookie so the frontend can use it in Authorization headers
// This allows existing sessions to work without re-login
app.get('/api/auth/token', (req, res) => {
  // Same precedence as authenticate() above (adminToken for the legacy
  // staff login, customerToken for staff/customers via the unified login) —
  // checking only adminToken meant every unified-login staff session 401'd
  // here permanently, since they never get that cookie at all.
  const token = req.cookies.adminToken || req.cookies.customerToken;
  if (!token) {
    return res.status(401).json({ error: 'No active session' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ token, role: decoded.role, username: decoded.username });
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Get all users (manage_users permission needed)
app.get('/api/admin/users', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// Create new user (manage_users permission needed)
app.post('/api/admin/users', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const { username, displayName, password, email, role, location, assignedLocations } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const newUser = new User({
      username,
      // Left blank on purpose when not supplied — displayNameOf() then derives
      // one from the username rather than storing a guess we would have to
      // keep in sync if the username ever changed.
      displayName: (displayName || '').trim(),
      password,
      email,
      role: role || 'sales_rep',
      location,
      assignedLocations: assignedLocations || ['Seattle']
    });

    await newUser.save();

    // Driver lists on open delivery boards are built from these accounts and are
    // cached client-side, so tell them to refetch instead of showing a stale name.
    req.app.get('io')?.emit('truck_update');

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser._id,
        username: newUser.username,
        displayName: newUser.displayName,
        name: displayNameOf(newUser),
        email: newUser.email,
        role: newUser.role,
        location: newUser.location,
        assignedLocations: newUser.assignedLocations
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user', error: error.message });
  }
});

// Update user (manage_users permission needed)
app.put('/api/admin/users/:id', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const { username, displayName, email, role, password, location, assignedLocations } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Read before anything is applied: displayNameOf() falls back to the
    // username, so a change to either field can change the name the rest of the
    // system shows for this person.
    const nameBefore = displayNameOf(user);

    // Check if new username is already taken by another user
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      user.username = username;
    }

    // Clearing the box is a real edit — '' means "go back to deriving it from
    // the username", so this is an !== undefined check, not a truthiness one.
    if (displayName !== undefined) user.displayName = String(displayName).trim();
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (location !== undefined) user.location = location;
    if (assignedLocations !== undefined) user.assignedLocations = assignedLocations;
    if (password) user.password = password; // Will be hashed by pre-save hook

    await user.save();

    // Customers cache their owning rep's name so the customer list — an
    // aggregation that pages over every account — needs no $lookup per row.
    // Nothing else re-derives that copy, so before this a rename left every
    // account the person owns labelled with the name they no longer go by, and
    // the delivery modal now reads that label onto new tickets, carrying the
    // stale name further. Re-point them here, where the rename happens.
    const nameAfter = displayNameOf(user);
    if (nameAfter !== nameBefore) {
      const { modifiedCount } = await Customer.updateMany(
        { salesRep: user._id },
        { $set: { salesRepName: nameAfter } }
      );
      if (modifiedCount > 0) {
        // The dropdown carries salesRepName, and only /api/customers writes bust
        // its cache — a rename reaches those records from a different route.
        bustCustomerCaches();
        console.log(`✏️ Rep renamed ${nameBefore} → ${nameAfter}: relabelled ${modifiedCount} customer record(s)`);
      }
    }

    // A rename has to reach every open board — see the create route above.
    req.app.get('io')?.emit('truck_update');

    res.json({
      message: 'User updated successfully',
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        name: displayNameOf(user),
        email: user.email,
        role: user.role,
        location: user.location,
        assignedLocations: user.assignedLocations
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

// Delete user (manage_users permission needed)
app.delete('/api/admin/users/:id', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    req.app.get('io')?.emit('truck_update');
    res.json({ message: 'User deleted successfully' });
  } catch {
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

// ============================================
// ROLE & PERMISSION MANAGEMENT ENDPOINTS
// ============================================

// Get all roles (manage_users permission needed)
app.get('/api/admin/roles', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const roles = await Role.find().sort({ name: 1 });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch roles', error: error.message });
  }
});

// Create a new custom role (manage_users permission needed)
app.post('/api/admin/roles', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const { name, displayName, permissions } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ message: 'Role name and display name are required' });
    }

    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '_');
    const existing = await Role.findOne({ name: cleanName });
    if (existing) {
      return res.status(400).json({ message: 'Role name already exists' });
    }

    const newRole = new Role({
      name: cleanName,
      displayName,
      permissions: permissions || [],
      isSystem: false
    });

    await newRole.save();
    res.status(201).json({ message: 'Role created successfully', role: newRole });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create role', error: error.message });
  }
});

// Update role permissions (manage_users permission needed)
app.put('/api/admin/roles/:id', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const { permissions, displayName } = req.body;
    const roleId = req.params.id;

    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    if (permissions !== undefined) role.permissions = permissions;
    if (displayName !== undefined) role.displayName = displayName;

    await role.save();
    res.json({ message: 'Role updated successfully', role });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update role', error: error.message });
  }
});

// Delete custom role (manage_users permission needed)
app.delete('/api/admin/roles/:id', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    if (role.isSystem) {
      return res.status(400).json({ message: 'Cannot delete system roles' });
    }

    await Role.findByIdAndDelete(roleId);
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete role', error: error.message });
  }
});

// ============================================
// DYNAMIC LOCATION MANAGEMENT ENDPOINTS
// ============================================

// Get all locations (authenticated staff or kiosks can view)
app.get('/api/admin/locations', verifyAnyAuth, async (req, res) => {
  try {
    const locations = await Location.find().sort({ name: 1 });
    res.json(locations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch locations', error: error.message });
  }
});

// Create a new location (manage_users permission needed)
app.post('/api/admin/locations', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Location name is required' });
    }

    const cleanName = name.trim();
    // Case-insensitive duplicate check
    const existing = await Location.findOne({ name: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ message: 'Location already exists' });
    }

    const location = new Location({ name: cleanName });
    await location.save();
    
    // Emit websocket update so frontend updates dynamically
    req.app.get('io').emit('location_update');
    
    res.status(201).json(location);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create location', error: error.message });
  }
});

// Delete a location (manage_users permission needed)
app.delete('/api/admin/locations/:id', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const locationId = req.params.id;
    const location = await Location.findById(locationId);
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    await Location.findByIdAndDelete(locationId);
    
    // Emit websocket update so frontend updates dynamically
    req.app.get('io').emit('location_update');
    
    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete location', error: error.message });
  }
});

// Change Password Route
app.post('/api/auth/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required' });
    }

    // Get adminId from JWT token (set by verifyToken middleware)
    const adminId = req.userId;
    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    // Verify current password
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      console.log('Current password incorrect');
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Update password (pre-save hook in User model will hash it)
    admin.password = newPassword;
    await admin.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('❌ Password change error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('adminToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

// Verify token endpoint — returns 200 with valid:false when no token (avoids 401 noise on public pages)
app.get('/api/auth/verify', (req, res) => {
  const adminToken = req.cookies.adminToken;
  const customerToken = req.cookies.customerToken;
  let authHeaderToken = null;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    authHeaderToken = req.headers.authorization.split(' ')[1];
  }

  // 1. Try admin token
  const effectiveAdminToken = adminToken || authHeaderToken;
  if (effectiveAdminToken) {
    try {
      const decoded = jwt.verify(effectiveAdminToken, JWT_SECRET);
      if (decoded.userId) {
        return res.json({
          valid: true,
          id: decoded.userId,
          role: decoded.role,
          authType: 'admin'
        });
      }
    } catch {
      // Admin token invalid, continue
    }
  }

  // 2. Try customer/internal token
  const effectiveCustomerToken = customerToken || authHeaderToken;
  if (effectiveCustomerToken) {
    try {
      const decoded = jwt.verify(effectiveCustomerToken, JWT_SECRET);
      if (decoded.type === 'customer' || decoded.type === 'internal') {
        return res.json({
          valid: true,
          id: decoded.id,
          role: decoded.type === 'internal' ? 'admin' : 'customer',
          authType: decoded.type === 'customer' ? 'customer' : 'admin'
        });
      }
    } catch {
      // Customer token invalid
    }
  }

  // No valid token — return 200 with valid:false instead of 401
  return res.json({ valid: false });
});

// Get current user info (for admin/internal users)
app.get('/api/user/me', authenticate, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(403).json({ message: 'Staff access required' });
    }
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Always fetch permissions fresh from DB (authenticate already did this, use req.user if available)
    const permissions = req.user?.permissions || [];

    res.json({
      id: user._id,
      username: user.username,
      displayName: user.displayName || '',
      name: displayNameOf(user),   // AuthContext exposes this as currentUser.name
      email: user.email,
      role: user.role,
      permissions,
      // Home branch, as distinct from every branch this person may work across.
      // It is what forms default a new record's branch to.
      location: user.location || '',
      assignedLocations: user.assignedLocations || ['Seattle'],
      routePlannerFilters: user.routePlannerFilters || {}
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to fetch user data' });
  }
});

// Route Planner's saved filter preferences — kept in its own file since
// more filter groups are expected to land here over time (see
// src/routes/routePlannerFilters.js).
app.use('/api/user/me/route-planner-filters', createRoutePlannerFiltersRouter({ authenticate }));
app.use('/api/geocode', createGeocodeRouter({ authenticate }));

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  try {
    const { name, company, email, phone, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required'
      });
    }

    // Save to MongoDB
    const contactSubmission = new ContactSubmission({
      name,
      company,
      email,
      phone,
      message,
      status: 'new',
      emailSent: false
    });

    await contactSubmission.save();
    console.log('📧 Contact form saved to database:', contactSubmission._id);

    // Try to send email alert
    const emailSentSuccessfully = await sendContactFormEmail(contactSubmission);
    if (emailSentSuccessfully) {
      contactSubmission.emailSent = true;
      await contactSubmission.save();
    }

    // Always return success - the form submission is logged
    res.json({
      success: true,
      message: 'Thank you for your message! We\'ll get back to you soon.'
    });
  } catch (error) {
    console.error('❌ Contact form error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again.'
    });
  }
});

// Customer Registration Endpoint
app.post('/api/customer/register', async (req, res) => {
  try {
    const { contactName, email, password, phone, company } = req.body;

    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ email });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create new customer
    const customer = new Customer({
      contactName,
      email,
      password,
      phone,
      company
    });

    await customer.save();

    // Generate JWT token
    const token = jwt.sign(
      { id: customer._id, type: 'customer' },
      JWT_SECRET,
      { expiresIn: '6h' }
    );

    // Set cookie
    res.cookie('customerToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 6 * 60 * 60 * 1000 // 6 hours
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: customer._id,
        contactName: customer.contactName,
        email: customer.email
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// Customer Login Endpoint
app.post('/api/customer/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid input format' });
    }

    // Trial query to check if connection is active
    console.log(`[${new Date().toISOString()}] 🔍 CONNECTION CHECK: Running countDocuments...`);
    try {
      const dbCheck = await Customer.countDocuments();
      console.log(`[${new Date().toISOString()}] ✅ CONNECTION CHECK SUCCESS: Found ${dbCheck} records`);
    } catch (checkErr) {
      console.error(`[${new Date().toISOString()}] ❌ CONNECTION CHECK FAILED:`, checkErr.message);
    }

    // Find customer or internal user
    const loginIdentifier = email ? email.trim().toLowerCase() : '';
    console.log(`[${new Date().toISOString()}] 🔍 DB QUERY START: Finding account for "${loginIdentifier}" (Original: "${email}")`);
    const startQuery = Date.now();
    let account;
    let accountType = 'customer';

    try {
      // 1. Try finding as a Customer first
      account = await Customer.findOne({ email: loginIdentifier }).select('-visits -resources');

      // 2. If not found in Customers, check internal Users
      if (!account) {
        account = await User.findOne({
          $or: [
            { email: loginIdentifier },
            { username: loginIdentifier }
          ]
        });

        if (account) {
          accountType = 'internal';
        }
      }

      console.log(`[${new Date().toISOString()}] ⏱️ DB QUERY END: Took ${Date.now() - startQuery}ms`);

      if (!account) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Check if account is locked
      if (typeof account.isLocked === 'function' && account.isLocked()) {
        return res.status(423).json({ message: 'Account locked. Please try again later.' });
      }

      // Verify password
      const isMatch = await account.comparePassword(password);

      if (!isMatch) {
        if (typeof account.incLoginAttempts === 'function') {
          await account.incLoginAttempts();
        }
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Reset login attempts if needed
      if (account.loginAttempts > 0 && typeof account.resetLoginAttempts === 'function') {
        await account.resetLoginAttempts();
      }
    } catch (dbError) {
      console.error(`[${new Date().toISOString()}] ❌ DB ERROR during account lookup:`, dbError);
      throw dbError;
    }

    // Reset login attempts and save IP address
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`💾 Updating ${accountType} login info (IP: ${ip}) for ${email}`);

    if (accountType === 'customer') {
      await Customer.updateOne({ _id: account._id }, {
        $set: {
          loginAttempts: 0,
          lastLoginIp: ip
        },
        $unset: { lockUntil: 1 },
        $push: {
          loginIps: {
            $each: [ip],
            $slice: -3
          }
        }
      });
    } else {
      await User.updateOne({ _id: account._id }, {
        $set: { loginAttempts: 0 },
        $unset: { lockUntil: 1 }
      });
    }

    // Generate JWT token — identity only, NO role stored in token
    // Role is always fetched live from DB by the authenticate middleware
    console.log(`🔑 Generating JWT for ${email} (Type: ${accountType})`);
    const token = jwt.sign(
      {
        id: account._id,
        type: accountType
        // role intentionally omitted — DB is the source of truth
      },
      JWT_SECRET,
      { expiresIn: '6h' }
    );

    // Set cookie
    res.cookie('customerToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 6 * 60 * 60 * 1000 // 6 hours
    });

    let permissions = [];
    if (accountType === 'internal') {
      const dbRole = await Role.findOne({ name: account.role });
      permissions = dbRole?.permissions || [];
    }

    console.log(`✅ Login successful for ${email} as ${accountType}`);
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: account._id,
        contactName: accountType === 'customer' ? account.contactName : (displayNameOf(account) || account.email),
        email: account.email,
        company: account.company || 'Easy Stones Internal',
        role: account.role || 'customer',
        type: accountType,
        permissions
      }
    });
  } catch (error) {
    console.error('❌ Login error details:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ message: `Login failed: ${error.message}` });
  }
});

// Customer Middleware
const verifyCustomer = (req, res, next) => {
  const token = req.cookies.customerToken;

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'customer' && decoded.type !== 'internal') {
      return res.status(401).json({ message: 'Invalid token type.' });
    }
    req.customerId = decoded.id;
    req.accountType = decoded.type;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

// Get current customer
app.get('/api/customer/me', verifyCustomer, async (req, res) => {
  try {
    let account;
    if (req.accountType === 'internal') {
      account = await User.findById(req.customerId).select('-password');
    } else {
      account = await Customer.findById(req.customerId).select('-password -visits -resources');
    }

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    let permissions = [];
    if (req.accountType === 'internal') {
      const dbRole = await Role.findOne({ name: account.role });
      permissions = dbRole?.permissions || [];
    }

    res.json({
      id: account._id,
      contactName: req.accountType === 'customer' ? account.contactName : (displayNameOf(account) || account.email),
      email: account.email,
      company: account.company || (req.accountType === 'internal' ? 'Easy Stones Internal' : ''),
      role: account.role || 'customer',
      type: req.accountType,
      permissions
    });
  } catch (error) {
    console.error('Get account error:', error);
    res.status(500).json({ message: 'Failed to fetch account data' });
  }
});

// Customer Authentication Middleware
// Customer Logout
app.post('/api/customer/logout', (req, res) => {
  res.clearCookie('customerToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.json({ message: 'Logged out successfully' });
});

// Dual Authentication Middleware - accepts both admin and customer tokens
// (Moved to top of file)

// Helper: Standardized User Attribution
const getPerformerInfo = async (req) => {
  let id = '';
  let name = '';
  let role = req.authType;

  if (req.authType === 'admin') {
    id = req.userId;
    const user = await User.findById(req.userId).select('username displayName');
    name = user ? displayNameOf(user) : `Unknown User (${req.userId})`;
  } else if (req.authType === 'customer') {
    id = req.customerId;
    const customer = await Customer.findById(req.customerId).select('contactName email');
    name = customer ? (customer.contactName || customer.email) : `Unknown Customer (${req.customerId})`;
  }

  return { id, name, role };
};

// Customer-accessible endpoint: Get all customers (for sales page)
// Customer-accessible endpoint: Get all customers (for sales page) - Optimized (No images)
app.get('/api/customers', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    let query = {};
    if (search) {
      const safeSearch = escapeRegex(search);
      query = {
        $or: [
          { contactName: { $regex: safeSearch, $options: 'i' } },
          { company: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } }
        ]
      };
    }

    const total = await Customer.countDocuments(query);

    const customers = await Customer.aggregate([
      { $match: query },
      {
        $addFields: {
          lastVisitDate: { $max: "$visits.date" }
        }
      },
      {
        $project: {
          password: 0,
          contacts: 0,
          "visits": 0,
          "resources": 0
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    ]);

    res.json({
      customers,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ message: 'Failed to fetch customers', error: error.message });
  }
});

// Get ALL customers for dropdown selection (minimal fields)
// Accessible by ALL authenticated users regardless of specific role permissions
app.get('/api/customers/dropdown', authenticate, async (req, res) => {
  try {
    const cached = cacheHit('customerDropdown');
    if (cached) return res.json(cached);

    const customers = await Customer.find({})
      // salesRepName rides along so a screen that picks a customer can fill in
      // the account's owning rep without a second round trip — the delivery
      // modal does exactly that. The cached label is enough; the id is not
      // needed, as nothing here writes back to the customer.
      .select('_id company contactName firstName lastName email customerType city address street state zip shippingAddress shippingCity billingAddress billingCity salesRepName')
      .sort({ company: 1, contactName: 1 })
      .lean();

    res.json(cachePut('customerDropdown', customers));
  } catch (error) {
    console.error('Error fetching customers for dropdown:', error);
    res.status(500).json({ message: 'Failed to fetch customers', error: error.message });
  }
});

/**
 * Every customer we hold a point for, as pins.
 *
 * Carries when each was last visited, because the question a rep actually asks
 * of a map is not "who is in Bellingham" but "who in Bellingham am I overdue
 * with" — and that answer is computed here, where the visits already live,
 * rather than by shipping 300-odd visit logs (with their photos) to the browser
 * to be reduced to one date each.
 *
 * Cached like the dropdown and busted by the same customer writes, which
 * includes logging a visit — the one write that changes what this returns.
 */
app.get('/api/customers/map', authenticate, requirePermission('view_route_planner'), async (req, res) => {
  try {
    const cached = cacheHit('customerMap');
    if (cached) return res.json(cached);

    const pins = await Customer.aggregate([
      { $match: { 'coordinates.lat': { $ne: null } } },
      {
        $project: {
          company: 1,
          contactName: 1,
          phone: 1,
          email: 1,
          marketingEmail: 1,
          street: '$address.street',
          city: '$address.city',
          state: '$address.state',
          coordinates: 1,
          precision: '$geocode.precision',
          salesRep: 1,
          salesRepName: 1,
          customerType: 1,
          status: 1,
          level: 1,
          location: 1,
          modaDisplay: 1,
          modaBinder: 1,
          notes: '$quickNote',
          // Visit dates are 'YYYY-MM-DD', so the newest is the largest string.
          lastVisitAt: { $max: '$visits.date' },
          visitCount: { $size: { $ifNull: ['$visits', []] } }
        }
      },
      { $sort: { company: 1, contactName: 1 } }
    ]);

    res.json(cachePut('customerMap', pins));
  } catch (error) {
    console.error('Error building customer map:', error);
    res.status(500).json({ message: 'Failed to load customer map', error: error.message });
  }
});

// Get dashboard statistics (optimized aggregation)
app.get('/api/dashboard/stats', authenticate, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const { timeRange = '7days', localDate } = req.query;
    const now = new Date();

    // Determine "Today" based on localDate from client or server now
    let targetDateStr = localDate;
    if (!targetDateStr) {
      const pstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      targetDateStr = `${pstDate.getFullYear()}-${String(pstDate.getMonth() + 1).padStart(2, '0')}-${String(pstDate.getDate()).padStart(2, '0')}`;
    }

    const [year, month, day] = targetDateStr.split('-').map(Number);
    // Use Face Value comparison for "Today" boundaries
    const todayStr = targetDateStr;
    const startOfTargetDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const endOfTargetDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    let startDate = null;
    let endDate = null;

    if (timeRange === '1day') {
      startDate = startOfTargetDay;
      endDate = endOfTargetDay;
    } else if (timeRange === '7days') {
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (timeRange === '30days') {
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    } else if (timeRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    const { id: userId, role } = req.authType === 'admin' ? { id: req.userId, role: req.userRole || 'admin' } : { id: req.customerId, role: 'customer' };
    const isAdmin = ['admin', 'director', 'manager'].includes(role);

    // If Admin/Manager, show all stats for the team. If regular salesperson/customer, filter by createdBy.
    const userMatchObj = isAdmin ? {} : { "visits.createdBy": userId.toString() };
    const visitDateMatch = getAggregationRangeMatch(startDate, endDate, "visits", userMatchObj);

    // Crucial: Pass the exact same string arguments as the visits endpoint to trigger the "Today + Future" logic
    let followUpStartStr = startDate ? startDate.toISOString().split('T')[0] : null;
    let followUpEndStr = endDate ? endDate.toISOString().split('T')[0] : null;
    if (timeRange === '1day') {
      // Force strings to be identical to trigger 'Today' logic in getFollowUpRangeMatch
      followUpStartStr = targetDateStr;
      followUpEndStr = targetDateStr;
    }

    // Create a mock object that getFollowUpRangeMatch will extract strings from
    const mockStartDate = followUpStartStr ? { toISOString: () => followUpStartStr + 'T' } : null;
    const mockEndDate = followUpEndStr ? { toISOString: () => followUpEndStr + 'T' } : null;

    const followUpDateMatchScoped = getFollowUpRangeMatch(mockStartDate, mockEndDate, userMatchObj);

    // The five rollups below are independent, so they run at once (Promise.all
    // further down) rather than one after another. Each filters and slims
    // customers before $unwind — see src/utils/dashboardMatch.js.
    const visitRangePrefilter = rangePrefilter(startDate, endDate, 'visits');

    // Aggregation for Visits Stats (Strictly by Visit Date)
    const visitStatsQuery = Customer.aggregate([
      ...(visitRangePrefilter ? [visitRangePrefilter] : []),
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      { $match: visitDateMatch },
      {
        $group: {
          _id: null,
          visits: {
            $sum: 1
          },
          keyVisits: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: { $ifNull: ["$visits.outcome", ""] }, regex: /order|sale|sold|deposit/i } },
                    { $regexMatch: { input: { $ifNull: ["$visits.notes", ""] }, regex: /order|sale|sold/i } }
                  ]
                },
                1, 0
              ]
            }
          },
          bids: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: { $ifNull: ["$visits.outcome", ""] }, regex: /bid|quote/i } },
                    { $regexMatch: { input: { $ifNull: ["$visits.notes", ""] }, regex: /bid|quote/i } }
                  ]
                },
                1, 0
              ]
            }
          },
          followUp: { $sum: 0 } // Move to separate aggregation
        }
      }
    ]);

    // Separate Aggregation for Follow-Up Stats (Strictly by Follow-Up Date)
    const followUpStatsQuery = Customer.aggregate([
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      { $match: followUpDateMatchScoped },
      { $count: "count" }
    ]);

    // Today's Schedule count

    const scheduleCountQuery = Customer.aggregate([
      followUpDatePrefilter(todayStr),
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      {
        $match: {
          ...userMatchObj,
          $expr: {
            $eq: [
              {
                $cond: [
                  { $eq: [{ $type: "$visits.followUpDate" }, "date"] },
                  { $dateToString: { format: "%Y-%m-%d", date: "$visits.followUpDate" } },
                  "$visits.followUpDate"
                ]
              },
              todayStr
            ]
          }
        }
      },
      { $count: "count" }
    ]);

    // Strictly filter by current user for dashboard resources

    const resourceRange = getAggregationRangeMatch(startDate, endDate, "resources");
    const resourcePrefilter = rangePrefilter(startDate, endDate, 'resources');
    const resourceStatsQuery = Customer.aggregate([
      ...(resourcePrefilter ? [resourcePrefilter] : []),
      ...slimForUnwind('resources'),
      { $unwind: "$resources" },
      {
        $match: {
          $expr: {
            $and: [
              {
                $or: [
                  { $eq: [{ $toString: "$resources.uploadedBy" }, userId.toString()] },
                  { $eq: [{ $toString: "$resources.createdBy" }, userId.toString()] }
                ]
              },
              (resourceRange.$expr || { $literal: true })
            ]
          }
        }
      },
      { $count: "count" }
    ]);

    // Count Unified Leads for current user (any Customer with a status set)
    const leadCountQuery = Customer.countDocuments({ 
      createdBy: userId, 
      status: { $exists: true } 
    });

    const [visitStats, followUpStats, scheduleCount, resourceStats, leadCount] = await Promise.all([
      visitStatsQuery, followUpStatsQuery, scheduleCountQuery, resourceStatsQuery, leadCountQuery
    ]);

    const result = {
      visits: visitStats[0]?.visits || 0,
      keyVisits: visitStats[0]?.keyVisits || 0,
      bids: visitStats[0]?.bids || 0,
      followUp: followUpStats[0]?.count || 0,
      resources: resourceStats[0]?.count || 0,
      leads: leadCount,
      todayScheduleCount: scheduleCount[0]?.count || 0
    };

    res.json(result);
  } catch (error) {
    console.error('Error calculating dashboard stats:', error);
    res.status(500).json({ message: 'Failed to calculate dashboard stats', error: error.message });
  }
});

// Get dashboard visits (returns a flat list for all customers in range)
app.get('/api/dashboard/visits', authenticate, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const { timeRange = 'all', localDate, filterType } = req.query;
    const now = new Date();

    // Determine "Today" based on localDate from client or server now
    let targetDateStr = localDate;
    if (!targetDateStr) {
      const pstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      targetDateStr = `${pstDate.getFullYear()}-${String(pstDate.getMonth() + 1).padStart(2, '0')}-${String(pstDate.getDate()).padStart(2, '0')}`;
    }

    const [year, month, day] = targetDateStr.split('-').map(Number);
    const startOfTargetDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const endOfTargetDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    let startDate = null;
    let endDate = null;

    if (timeRange === '1day') {
      startDate = startOfTargetDay;
      endDate = endOfTargetDay;
    } else if (timeRange === '7days') {
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (timeRange === '30days') {
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    } else if (timeRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    const { id: userId, role } = req.authType === 'admin' ? { id: req.userId, role: req.userRole || 'admin' } : { id: req.customerId, role: 'customer' };
    const isAdmin = ['admin', 'director', 'manager'].includes(role);

    // If Admin/Manager, show all data. Otherwise filter by creator.
    const userMatchObj = isAdmin ? {} : { "visits.createdBy": userId.toString() };

    // Handle fallback logic for matching
    const dateMatch = filterType === 'followup'
      ? getFollowUpRangeMatch(startDate, endDate, userMatchObj)
      : getAggregationRangeMatch(startDate, endDate, "visits", userMatchObj);

    // Filter and slim customers before $unwind (src/utils/dashboardMatch.js).
    // Follow-ups have no early filter: getFollowUpRangeMatch also counts an
    // entry whose follow-up fields are missing, so nearly every visit passes.
    const visitPrefilter = filterType === 'followup' ? null : rangePrefilter(startDate, endDate, 'visits');
    const visits = await Customer.aggregate([
      ...(visitPrefilter ? [visitPrefilter] : []),
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      { $match: dateMatch },
      {
        $project: {
          _id: "$visits._id",
          date: {
            $cond: [
              { $eq: [{ $type: "$visits.date" }, "string"] },
              "$visits.date",
              {
                $ifNull: [
                  "$visits.date",
                  {
                    $cond: [
                      { $eq: [{ $type: "$visits.createdAt" }, "date"] },
                      { $dateToString: { format: "%Y-%m-%d", date: "$visits.createdAt" } },
                      { $substr: ["$visits.createdAt", 0, 10] }
                    ]
                  }
                ]
              }
            ]
          },
          purpose: "$visits.purpose",
          notes: "$visits.notes",
          outcome: "$visits.outcome",
          nextAction: "$visits.nextAction",
          followUp: "$visits.followUp",
          followUpDate: "$visits.followUpDate",
          createdBy: "$visits.createdBy",
          createdAt: {
            $cond: [
              { $eq: [{ $type: "$visits.createdAt" }, "date"] },
              { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$visits.createdAt" } },
              "$visits.createdAt"
            ]
          },
          customerId: "$_id",
          customerName: {
            $concat: [
              { $ifNull: ["$company", ""] },
              { $cond: [{ $and: ["$company", "$contactName"] }, " - ", ""] },
              { $ifNull: ["$contactName", ""] }
            ]
          }
        }
      },
      { $sort: { date: -1, createdAt: -1 } }
    ]);

    res.json(visits);
  } catch (error) {
    console.error('Error fetching dashboard visits:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard visits' });
  }
});

// Get dashboard resources (returns a flat list for all customers in range)
app.get('/api/dashboard/resources', authenticate, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const { timeRange = 'all', localDate } = req.query;
    const now = new Date();

    // Determine "Today" based on localDate from client or server now
    let targetDateStr = localDate;
    if (!targetDateStr) {
      const pstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      targetDateStr = `${pstDate.getFullYear()}-${String(pstDate.getMonth() + 1).padStart(2, '0')}-${String(pstDate.getDate()).padStart(2, '0')}`;
    }

    const [year, month, day] = targetDateStr.split('-').map(Number);
    const startOfTargetDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const endOfTargetDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    let startDate = null;
    let endDate = null;

    if (timeRange === '1day') {
      startDate = startOfTargetDay;
      endDate = endOfTargetDay;
    } else if (timeRange === '7days') {
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (timeRange === '30days') {
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    } else if (timeRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    const userId = req.authType === 'admin' ? req.userId : req.customerId;
    

    

    // For resources, let's stick to the $or match outside $expr if possible, 
    // OR wrap it properly.
    const rangeMatch = getAggregationRangeMatch(startDate, endDate, "resources");

    const resourceMatchStage = {
      $expr: {
        $and: [
          {
            $or: [
              { $eq: [{ $toString: "$resources.uploadedBy" }, userId.toString()] },
              { $eq: [{ $toString: "$resources.createdBy" }, userId.toString()] }
            ]
          },
          (rangeMatch.$expr || { $literal: true })
        ]
      }
    };

    const resourcePrefilter = rangePrefilter(startDate, endDate, 'resources');
    const resources = await Customer.aggregate([
      ...(resourcePrefilter ? [resourcePrefilter] : []),
      ...slimForUnwind('resources'),
      { $unwind: "$resources" },
      { $match: resourceMatchStage },
      {
        $project: {
          _id: "$resources._id",
          name: "$resources.name",
          description: "$resources.description",
          type: "$resources.type",
          resourceType: "$resources.resourceType",
          date: {
            $cond: [
              { $eq: [{ $type: "$resources.date" }, "string"] },
              "$resources.date",
              {
                $ifNull: [
                  "$resources.date",
                  {
                    $cond: [
                      { $eq: [{ $type: "$resources.createdAt" }, "date"] },
                      { $dateToString: { format: "%Y-%m-%d", date: "$resources.createdAt" } },
                      { $substr: ["$resources.createdAt", 0, 10] }
                    ]
                  }
                ]
              }
            ]
          },
          content: "$resources.content",
          uploadedBy: "$resources.uploadedBy",
          createdAt: {
            $cond: [
              { $eq: [{ $type: "$resources.createdAt" }, "date"] },
              { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$resources.createdAt" } },
              "$resources.createdAt"
            ]
          },
          customerId: "$_id",
          customerName: {
            $concat: [
              { $ifNull: ["$company", ""] },
              { $cond: [{ $and: ["$company", "$contactName"] }, " - ", ""] },
              { $ifNull: ["$contactName", ""] }
            ]
          }
        }
      },
      { $sort: { date: -1, createdAt: -1 } }
    ]);

    res.json(resources);
  } catch (error) {
    console.error('Error fetching dashboard resources:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard resources' });
  }
});

// Get single customer with full details (including images)
app.get('/api/customers/:id', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const customerObj = await Customer.findById(req.params.id)
      .populate('associatedCustomers', 'contactName company customerType status phone visits')
      .select('-password')
      .lean();
    if (!customerObj) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Add calculated fields for dormancy alerts
    customerObj.lastVisitDate = customerObj.visits && customerObj.visits.length > 0
      ? customerObj.visits.reduce((latest, v) => (v.date > latest ? v.date : latest), customerObj.visits[0].date)
      : null;

    // Calculate lastVisitDate for each associated customer and strip visits payload
    if (customerObj.associatedCustomers && customerObj.associatedCustomers.length > 0) {
      customerObj.associatedCustomers = customerObj.associatedCustomers.map(partner => {
        const lastVisit = partner.visits && partner.visits.length > 0
          ? partner.visits.reduce((latest, v) => (v.date > latest ? v.date : latest), partner.visits[0].date)
          : null;
        const cleanPartner = { ...partner, lastVisitDate: lastVisit };
        delete cleanPartner.visits; // Strip out visits list from partner objects to reduce network payload
        return cleanPartner;
      });
    }

    res.json(customerObj);
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ message: 'Failed to fetch customer details', error: error.message });
  }
});

// ============================================
// PARTNER ASSOCIATIONS ENDPOINTS
// ============================================

// Link customer to a partner (bi-directional association)
app.post('/api/customers/:customerId/associations', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { partnerId } = req.body;
    const { customerId } = req.params;

    if (!partnerId) {
      return res.status(400).json({ message: 'partnerId is required' });
    }

    if (customerId === partnerId) {
      return res.status(400).json({ message: 'Cannot link a customer to themselves' });
    }

    // Check if both exist
    const [customer, partner] = await Promise.all([
      Customer.findById(customerId),
      Customer.findById(partnerId)
    ]);

    if (!customer || !partner) {
      return res.status(404).json({ message: 'One or both customers not found' });
    }

    // Bi-directional link using $addToSet to avoid duplicates
    await Promise.all([
      Customer.findByIdAndUpdate(customerId, { $addToSet: { associatedCustomers: partnerId } }),
      Customer.findByIdAndUpdate(partnerId, { $addToSet: { associatedCustomers: customerId } })
    ]);

    res.json({ message: 'Association established successfully' });
  } catch (error) {
    console.error('Error establishing association:', error);
    res.status(500).json({ message: 'Failed to establish association', error: error.message });
  }
});

// Remove customer association (bi-directional unlinking) — manage_customers
// kept alongside delete_customers, same reasoning as /api/partners/:id DELETE
// above: the client here has no permission check of its own, so dropping it
// would silently break this for any role that predates delete_customers.
app.delete('/api/customers/:customerId/associations/:partnerId', authenticate, requireAnyPermission('manage_customers', 'delete_customers'), async (req, res) => {
  try {
    const { customerId, partnerId } = req.params;

    // Bi-directional unlink using $pull
    await Promise.all([
      Customer.findByIdAndUpdate(customerId, { $pull: { associatedCustomers: partnerId } }),
      Customer.findByIdAndUpdate(partnerId, { $pull: { associatedCustomers: customerId } })
    ]);

    res.json({ message: 'Association removed successfully' });
  } catch (error) {
    console.error('Error removing association:', error);
    res.status(500).json({ message: 'Failed to remove association', error: error.message });
  }
});

// ============================================
// CONTACTS CRUD ENDPOINTS
// ============================================

// Add contact to customer
app.post('/api/customers/:customerId/contacts', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { customerId } = req.params;
    const { name, phone, email, role, notes } = req.body;

    const newContact = {
      name,
      phone,
      email,
      role,
      notes,
      createdAt: getNowLocalISO(),
      createdBy: (await getPerformerInfo(req)).id
    };

    const result = await Customer.updateOne(
      { _id: customerId },
      { $push: { contacts: newContact } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.status(201).json({ success: true, contact: newContact });
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({ message: 'Failed to add contact' });
  }
});



// Get list of sales reps (all users for autocomplete/suggestions)
// Staff-only: this is an internal directory (usernames, emails, roles, locations)
// and was previously reachable unauthenticated.
app.get('/api/salesreps', authenticate, async (req, res) => {
  try {
    const cached = cacheHit('salesreps');
    if (cached) return res.json(cached);

    const users = await User.find({}, 'username displayName email role location assignedLocations');
    const formattedUsers = users.map(user => ({
      // Consumers that store a reference to a person — the customer's owning
      // rep, for one — need the id, not just the name.
      _id: user._id,
      username: user.username,
      displayName: user.displayName || '',
      name: displayNameOf(user),   // what every consumer of this list renders
      email: user.email,
      role: user.role,
      location: user.location,
      assignedLocations: user.assignedLocations || []
    }));
    res.json(cachePut('salesreps', { success: true, data: formattedUsers }));
  } catch (error) {
    console.error('Error fetching sales reps:', error);
    res.status(500).json({ message: 'Failed to fetch sales reps' });
  }
});

// Update contact
app.put('/api/customers/:customerId/contacts/:contactId', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { customerId, contactId } = req.params;
    const fields = req.body;

    const updateData = {};
    const { id: updatedBy } = await getPerformerInfo(req);
    updateData[`contacts.$.updatedBy`] = updatedBy;

    Object.keys(fields).forEach(key => {
      updateData[`contacts.$.${key}`] = fields[key];
    });

    const result = await Customer.updateOne(
      { _id: customerId, 'contacts._id': contactId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or contact not found' });
    }

    res.json({ success: true, message: 'Contact updated successfully' });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ message: 'Failed to update contact' });
  }
});

// Change Password Route
app.post('/api/auth/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect current password' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================
// SALES DASHBOARD RESOURCE ENDPOINTS
// ============================================

// Get all dashboard resources (Support folder navigation)
app.get('/api/sales-dashboard/resources', verifyAnyAuth, async (req, res) => {
  try {
    const { parentId } = req.query;
    const query = parentId ? { parentId } : { parentId: null };


    // Also support getting ALL resources if specifically requested (for search maybe?) - avoiding for now to keep simple
    const resources = await SalesDashboardResource.find(query)
      .select('-content')
      .populate('uploadedBy', 'username') // Populate username
      .sort({ isFolder: -1, createdAt: -1 }); // Folders first, exclude content

    res.json(resources);
  } catch (error) {
    console.error('❌ Error fetching dashboard resources:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard resources' });
  }
});

// Get single resource (with full content)
app.get('/api/sales-dashboard/resources/:id', verifyAnyAuth, async (req, res) => {
  try {
    const resource = await SalesDashboardResource.findById(req.params.id).populate('uploadedBy', 'username');
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    res.json(resource);
  } catch {
    res.status(500).json({ message: 'Failed to fetch resource' });
  }
});

// Upload a new resource (File, Link, or Folder)
app.post('/api/sales-dashboard/upload', verifyAnyAuth, uploadResources.single('file'), async (req, res) => {
  try {
    const { name, type, content: linkContent, isFolder, parentId, thumbnail } = req.body;

    let content = '';
    let contentType = 'application/octet-stream';

    // Handle Folder Creation
    if (isFolder === 'true' || isFolder === true) {
      content = '';
      contentType = 'application/vnd.google-apps.folder';
    }
    // Handle File Upload
    else if (req.file) {
      const uploadDir = path.join(__dirname, 'public/uploads/resources');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const isImage = req.file.mimetype.startsWith('image/');
      let filename = '';
      

      if (isImage) {

        const result = await uploadToCloudinary(req.file.buffer, 'Resources', `res_${uniqueSuffix}`);
        content = result.secure_url;
        contentType = 'image/webp';
      } else {
        filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueSuffix}${path.extname(req.file.originalname)}`;
        contentType = req.file.mimetype;

        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, req.file.buffer);
        content = `/uploads/resources/${filename}`;
      }
    }
    // Handle Link
    else if (type === 'link') {
      content = linkContent;
      contentType = 'text/uri-list';
    } else {
      return res.status(400).json({ message: 'Invalid resource data' });
    }

    const newResource = new SalesDashboardResource({
      name,
      type: isFolder === 'true' || isFolder === true ? 'folder' : type,
      content,
      contentType,
      isFolder: isFolder === 'true' || isFolder === true,
      parentId: parentId || null,
      thumbnail: thumbnail || '',
      uploadedBy: req.userId, // Save the user who uploaded/created
      createdAt: getNowLocalISO()
    });

    
    await newResource.save();

    // Populate before returning
    await newResource.populate('uploadedBy', 'username');
    req.app.get('io').emit('resource_update');
    res.status(201).json(newResource);
  } catch (error) {
    console.error('Error uploading dashboard resource:', error);
    res.status(500).json({ message: 'Failed to upload resource' });
  }
});

// Update dashboard resource
app.put('/api/sales-dashboard/resources/:id', verifyAnyAuth, uploadResources.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, content: linkContent, parentId, thumbnail } = req.body;

    const resource = await SalesDashboardResource.findById(id);
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    if (name) resource.name = name;
    if (parentId !== undefined) resource.parentId = parentId || null;

    // Update modified by
    if (req.userId) {
      resource.uploadedBy = req.userId;
    }

    // If a new file is uploaded
    if (req.file) {
      // Delete old file if it was a disk file
      if (resource.content && resource.content.startsWith('/uploads/')) {
        const oldPath = path.join(__dirname, 'public', resource.content);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { console.error('Failed to delete old file:', e); }
        }
      }

      const uploadDir = path.join(__dirname, 'public/uploads/resources');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const isImage = req.file.mimetype.startsWith('image/');
      let filename = ''; // Declare filename here for both branches
      if (isImage) {

        const result = await uploadToCloudinary(req.file.buffer, 'Resources', `res_${uniqueSuffix}`);
        resource.content = result.secure_url;
        resource.contentType = 'image/webp';
      } else {
        filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueSuffix}${path.extname(req.file.originalname)}`;
        resource.contentType = req.file.mimetype;

        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, req.file.buffer);
        resource.content = `/uploads/resources/${filename}`;
      }
    } else if (type === 'link' && linkContent) {
      resource.content = linkContent;
      resource.contentType = 'text/uri-list';
    }

    if (thumbnail) resource.thumbnail = thumbnail;

    await resource.save();
    req.app.get('io').emit('resource_update');
    res.json(resource);
  } catch (error) {
    console.error('Error updating dashboard resource:', error);
    res.status(500).json({ message: 'Failed to update resource' });
  }
});

// Delete dashboard resource (Recursive for folders)
app.delete('/api/sales-dashboard/resources/:id', verifyAnyAuth, async (req, res) => {
  try {
    const resourceId = req.params.id;
    const resource = await SalesDashboardResource.findById(resourceId);

    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    if (resource.isFolder) {
      // Recursive delete: Find all children and delete them
      // Note: For deep nesting, this should be recursive function, but 
      // typically MongoDB $graphLookup or separate logic is used. 
      // For simplicity, we'll just delete direct children or use a recursive function.
      // Let's implement a helper function for recursive delete.

      const deleteFolderContents = async (folderId) => {
        const children = await SalesDashboardResource.find({ parentId: folderId });
        for (const child of children) {
          if (child.isFolder) {
            await deleteFolderContents(child._id);
          } else if (child.content && child.content.startsWith('/uploads/')) {
            // Delete file from disk
            const filePath = path.join(__dirname, 'public', child.content);
            if (fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch { /* not fatal — carry on */ }
            }
          }
          await SalesDashboardResource.findByIdAndDelete(child._id);
        }
      };
      await deleteFolderContents(resourceId);
    } else if (resource.content && resource.content.startsWith('/uploads/')) {
      // Delete file from disk
      const filePath = path.join(__dirname, 'public', resource.content);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* not fatal — carry on */ }
      }
    }

    await SalesDashboardResource.findByIdAndDelete(resourceId);
    req.app.get('io').emit('resource_update');
    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Error deleting resource:', error);
    res.status(500).json({ message: 'Failed to delete resource' });
  }
});

// ============================================
// GET DISTINCT CITIES (For dropdown checklists)
app.get('/api/partners/cities', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const cities1 = await Customer.distinct('city');
    const cities2 = await Customer.distinct('address.city');
    const mergedCities = Array.from(new Set([...cities1, ...cities2]))
      .filter(Boolean)
      .map(c => c.trim())
      .sort();
    res.json(mergedCities);
  } catch (error) {
    console.error('Error fetching distinct cities:', error);
    res.status(500).json({ message: 'Failed to fetch distinct cities' });
  }
});

// CUSTOMER LIST (Spreadsheet Data Source with Pagination & Search)
app.get('/api/partners', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limitInput = parseInt(req.query.limit);
    const limit = isNaN(limitInput) ? 50 : limitInput;
    const search = req.query.search || '';
    const filterLevel = req.query.level || '';
    const filterType = req.query.type || '';
    const filterTypeExclude = req.query.typeExclude || ''; // comma-separated types to exclude
    const filterCity = req.query.city || '';
    const filterStatus = req.query.status || '';
    const filterSalesRep = req.query.salesRep || '';
    const filterLocation = req.query.location || '';
    const skip = (page - 1) * limit;

    let query = {};

    // Build filter conditions
    const filterConditions = [];

    if (search) {
      const safeSearch = escapeRegex(search);
      filterConditions.push({
        $or: [
          { company: { $regex: safeSearch, $options: 'i' } },
          { contactName: { $regex: safeSearch, $options: 'i' } },
          { name: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } },
          { phone: { $regex: safeSearch, $options: 'i' } },
          { city: { $regex: safeSearch, $options: 'i' } },
          { status: { $regex: safeSearch, $options: 'i' } }
        ]
      });
    }

    if (filterStatus) {
      const statuses = filterStatus.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        filterConditions.push({ status: { $in: statuses } });
      }
    }

    if (filterLevel) {
      const levels = filterLevel.split(',').map(l => l.trim()).filter(Boolean);
      if (levels.length > 0) {
        filterConditions.push({ level: { $in: levels } });
      }
    }
    if (filterType) {
      const types = filterType.split(',').map(t => t.trim()).filter(Boolean);
      if (types.length > 0) {
        const orConditions = [];
        const nonFabricatorTypes = [];
        let hasFabricator = false;

        types.forEach(t => {
          if (t.toLowerCase() === 'fabricator') {
            hasFabricator = true;
          } else {
            nonFabricatorTypes.push(t);
          }
        });

        if (hasFabricator) {
          orConditions.push(
            { customerType: { $regex: /^fabricator$/i } },
            { customerType: null },
            { customerType: { $exists: false } },
            { customerType: '' }
          );
        }
        if (nonFabricatorTypes.length > 0) {
          orConditions.push({ customerType: { $in: nonFabricatorTypes } });
        }

        if (orConditions.length > 0) {
          filterConditions.push(orConditions.length === 1 ? orConditions[0] : { $or: orConditions });
        }
      }
    }
    if (filterTypeExclude) {
      const excludeList = filterTypeExclude.split(',').map(t => t.trim()).filter(Boolean);
      if (excludeList.length > 0) {
        // When excluding 'Fabricator', also exclude records where customerType is null/empty/missing
        // because the UI renders those as "Fabricator" by default.
        const isFabricatorExcluded = excludeList.some(t => t.toLowerCase() === 'fabricator');
        if (isFabricatorExcluded) {
          // Must have a non-null, non-empty customerType that is not a Fabricator (case-insensitive)
          filterConditions.push({
            $and: [
              { customerType: { $exists: true } },
              { customerType: { $ne: null } },
              { customerType: { $ne: '' } },
              { customerType: { $not: { $regex: /^fabricator$/i } } }
            ]
          });
        } else {
          filterConditions.push({ customerType: { $nin: excludeList } });
        }
      }
    }
    if (filterCity) {
      const cities = filterCity.split(',').map(c => c.trim()).filter(Boolean);
      if (cities.length > 0) {
        const cityOrs = [];
        cities.forEach(c => {
          cityOrs.push(
            { city: { $regex: c, $options: 'i' } },
            { 'address.city': { $regex: c, $options: 'i' } }
          );
        });
        filterConditions.push({ $or: cityOrs });
      }
    }

    // Owning rep. The literal 'unassigned' is a selectable value, not an id —
    // it is how someone pulls up the accounts still waiting to be claimed, so
    // it has to match records where the field is null, missing or was cleared.
    if (filterSalesRep) {
      const reps = filterSalesRep.split(',').map(r => r.trim()).filter(Boolean);
      const wantsUnassigned = reps.some(r => r.toLowerCase() === 'unassigned');
      const repIds = reps
        .filter(r => mongoose.Types.ObjectId.isValid(r))
        .map(r => new mongoose.Types.ObjectId(r));

      const repOrs = [];
      if (repIds.length > 0) repOrs.push({ salesRep: { $in: repIds } });
      if (wantsUnassigned) repOrs.push({ salesRep: { $in: [null] } });

      if (repOrs.length > 0) {
        filterConditions.push(repOrs.length === 1 ? repOrs[0] : { $or: repOrs });
      }
    }

    // Branch. Records predating the field are Seattle's — the startup migration
    // backfills them, but match a missing value to Seattle regardless so a
    // Seattle filter is right even on a database that has not been migrated yet.
    if (filterLocation) {
      const locations = filterLocation.split(',').map(l => l.trim()).filter(Boolean);
      if (locations.length > 0) {
        const locationOrs = [{ location: { $in: locations } }];
        if (locations.some(l => l.toLowerCase() === 'seattle')) {
          locationOrs.push({ location: { $in: [null, ''] } }, { location: { $exists: false } });
        }
        filterConditions.push(locationOrs.length === 1 ? locationOrs[0] : { $or: locationOrs });
      }
    }

    if (filterConditions.length > 0) {
      query = filterConditions.length === 1 ? filterConditions[0] : { $and: filterConditions };
    }

    const sortBy = req.query.sortBy || 'level';
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;

    // Build the dynamic sort stage. Low-priority statuses always float to the bottom,
    // and we sort by the chosen sortBy field within those groupings.
    const sortStage = { sortPriority: 1 };
    if (sortBy === 'company') {
      sortStage.normalizedCompany = sortOrder;
    } else if (sortBy === 'level') {
      sortStage.level = sortOrder;
      sortStage.normalizedCompany = 1;
    } else if (sortBy === 'city') {
      sortStage.normalizedCity = sortOrder;
    } else if (sortBy === 'salesRep') {
      // Unassigned accounts hold '' and so group together at one end, which is
      // the useful reading of this sort — the backlog in one block.
      sortStage.salesRepName = sortOrder;
      sortStage.normalizedCompany = 1;
    } else if (sortBy === 'location') {
      sortStage.normalizedLocation = sortOrder;
      sortStage.normalizedCompany = 1;
    } else {
      sortStage.createdAt = -1; // Default fallback to newest first
    }

    const totalCount = await Customer.countDocuments(query);

    // The fields the sort reads but the documents do not carry directly. Held in
    // one place because the paginated and export pipelines below must agree on
    // them exactly — when they were written out twice they were one edit away
    // from sorting the export differently from the page it was exported from.
    const sortFields = {
      $addFields: {
        sortPriority: {
          $cond: {
            if: {
              $in: ["$status", ["Different Sales Person", "Not Interested"]]
            },
            then: 1,
            else: 0
          }
        },
        normalizedCity: {
          $cond: {
            if: { $and: [{ $gt: ["$city", null] }, { $ne: ["$city", ""] }] },
            then: "$city",
            else: { $ifNull: ["$address.city", ""] }
          }
        },
        // A record with no branch is a Seattle record that predates the field,
        // so it sorts with Seattle rather than ahead of everything.
        normalizedLocation: {
          $cond: {
            if: { $and: [{ $gt: ["$location", null] }, { $ne: ["$location", ""] }] },
            then: "$location",
            else: "Seattle"
          }
        },
        normalizedCompany: {
          $cond: {
            if: { $and: [{ $gt: ["$company", null] }, { $ne: ["$company", ""] }] },
            then: "$company",
            else: {
              $cond: {
                if: { $and: [{ $gt: ["$name", null] }, { $ne: ["$name", ""] }] },
                then: "$name",
                else: { $ifNull: ["$contactName", ""] }
              }
            }
          }
        }
      }
    };

    const hideHeavyFields = {
      $project: {
        password: 0,
        contacts: 0,
        visits: 0,
        resources: 0
      }
    };

    const customers = await Customer.aggregate(
      limit === -1
        ? [{ $match: query }, sortFields, { $sort: sortStage }, hideHeavyFields]
        : [{ $match: query }, sortFields, { $sort: sortStage }, hideHeavyFields, { $skip: skip }, { $limit: limit }]
    );

    res.json({
      partners: customers,
      totalCount,
      totalPages: Math.ceil(totalCount / (limit === -1 ? totalCount || 1 : limit)),
      currentPage: page
    });
  } catch (error) {
    console.error('Error fetching customer list:', error);
    res.status(500).json({ message: 'Failed to fetch customer list' });
  }
});

// Create a new lead (as a Customer)
app.post('/api/partners', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    let priceLevel = req.body.priceLevel;
    if (req.body.level) {
      const match = req.body.level.match(/\d+/);
      if (match) {
        priceLevel = parseInt(match[0], 10);
      }
    }

    // Resolved from the id rather than read off the body, so the stored label
    // always names the account it points at. Listed after the spread for the
    // same reason — a client-sent salesRepName must not survive.
    const rep = await resolveSalesRep(req.body.salesRep);

    const address = {
      street: req.body.address?.street || '',
      city: req.body.address?.city || req.body.city || '',
      state: req.body.address?.state || '',
      zipCode: req.body.address?.zipCode || ''
    };

    // Derived here rather than accepted from the body, for the same reason the
    // rep is: a point the client made up would put a pin somewhere nobody can
    // account for. An address that cannot be resolved still saves.
    const geo = await geocodeAddress(address);

    const newCustomer = new Customer({
      ...req.body,
      ...rep,
      ...geo,
      location: String(req.body.location || '').trim() || 'Seattle',
      priceLevel: priceLevel || req.body.priceLevel || 1,
      contactName: req.body.contactName || req.body.name || 'Unknown', // Map contactName/name to contactName
      marketingEmail: req.body.marketingEmail || req.body.email || '',
      receiveMarketing: req.body.receiveMarketing !== undefined ? req.body.receiveMarketing : true,
      address,
      password: '', // Leads don't have passwords yet
      isVerified: false,
      createdBy: req.userId
    });
    await newCustomer.save();
    req.app.get('io').emit('customer_update');
    console.log(`✅ Unified Lead (Customer) created: ${req.body.company}`);
    res.status(201).json(newCustomer);
  } catch (error) {
    console.error('Error creating customer-lead:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update a lead (Customer)
app.put('/api/partners/:id', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.body.level) {
      const match = req.body.level.match(/\d+/);
      if (match) {
        updateData.priceLevel = parseInt(match[0], 10);
      }
    }

    if (req.body.contactName) {
      updateData.contactName = req.body.contactName;
    } else if (req.body.name) {
      updateData.contactName = req.body.name;
    }

    // Only touch the rep when the edit actually carried one, so a partial update
    // cannot silently unassign an account. When it did, both halves are rewritten
    // together — including clearing the cached name as the rep is cleared, rather
    // than leaving a name behind pointing at nobody.
    delete updateData.salesRepName;
    if (req.body.salesRep !== undefined) {
      Object.assign(updateData, await resolveSalesRep(req.body.salesRep));
    }

    if (req.body.location !== undefined) {
      updateData.location = String(req.body.location || '').trim() || 'Seattle';
    }

    // The point and the label for it are derived from the address, never taken
    // from the body — a client-sent pin would sit somewhere nobody can account for.
    delete updateData.coordinates;
    delete updateData.geocode;

    // Needed twice below: the stored address, because findByIdAndUpdate replaces
    // a nested object wholesale and a city-only edit would otherwise drop the
    // street; and the key the stored point came from, because re-geocoding is
    // only worth paying for when the address actually moved.
    const existing = await Customer.findById(req.params.id).select('address geocode').lean();
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (req.body.address) {
      updateData.address = {
        street: req.body.address.street || '',
        city: req.body.address.city || req.body.city || '',
        state: req.body.address.state || '',
        zipCode: req.body.address.zipCode || ''
      };
    } else if (req.body.city) {
      updateData.address = {
        ...existing.address,
        city: req.body.city
      };
    }

    if (updateData.address) {
      const geo = await geocodePatchFor(updateData.address, existing.geocode?.addressKey || '');
      if (geo) Object.assign(updateData, geo);
    }

    const updatedCustomer = await Customer.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedCustomer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    req.app.get('io').emit('customer_update');
    res.json(updatedCustomer);
  } catch (error) {
    console.error('Error updating unified lead:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete a lead (Customer) — manage_customers kept alongside delete_customers
// so PartnersSheet.jsx's delete button (which has no client-side permission
// check of its own, unlike the route planner's icon) keeps working for every
// role that already had manage_customers before delete_customers existed as
// its own permission.
app.delete('/api/partners/:id', authenticate, requireAnyPermission('manage_customers', 'delete_customers'), async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    req.app.get('io').emit('customer_update');
    res.json({ message: 'Lead record removed successfully' });
  } catch (error) {
    console.error('Error deleting lead record:', error);
    res.status(500).json({ message: 'Failed to delete record' });
  }
});

// ============================================
// VISITS CRUD ENDPOINTS
// ============================================

// Get single visit detail
app.get('/api/customers/:customerId/visits/:visitId', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const { customerId, visitId } = req.params;


    // Use projection to get ONLY the specific visit
    const customer = await Customer.findOne(
      { _id: customerId, 'visits._id': visitId },
      { 'visits.$': 1 }
    ).lean();

    if (!customer || !customer.visits || customer.visits.length === 0) {

      return res.status(404).json({ message: 'Visit not found' });
    }

    const visit = customer.visits[0];


    res.json({ visit });
  } catch (error) {
    console.error('[ERROR] Failed to fetch visit detail:', error);
    res.status(500).json({ message: 'Failed to fetch visit detail', error: error.message });
  }
});

// Get single resource detail
app.get('/api/customers/:customerId/resources/:resourceId', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;


    // Use projection to get ONLY the specific resource
    const customer = await Customer.findOne(
      { _id: customerId, 'resources._id': resourceId },
      { 'resources.$': 1 }
    ).lean();

    if (!customer || !customer.resources || customer.resources.length === 0) {

      return res.status(404).json({ message: 'Resource not found' });
    }

    const resource = customer.resources[0];


    res.json({ resource });
  } catch (error) {
    console.error('[ERROR] Failed to fetch resource detail:', error);
    res.status(500).json({ message: 'Failed to fetch resource detail', error: error.message });
  }
});

// Helper function to ensure dates are stored as strings (YYYY-MM-DD format)
// This prevents MongoDB from converting them to Date objects with timezone shifts
const ensureDateString = (dateValue) => {
  if (!dateValue) return dateValue;
  if (typeof dateValue === 'string') {
    // If it involves a time component (ISO string), keep it to preserve specific time
    // This fixes the issue where dates are forced to UTC midnight (and thus shift days in US timezones)
    if (dateValue.includes('T')) {
      return dateValue;
    }
    // If it's already a string in YYYY-MM-DD format, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }
  }
  // If it's a Date object or other format, convert to YYYY-MM-DD
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return dateValue; // Return original if invalid
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNowLocalISO = () => {
  const now = new Date();
  // Use PST (America/Los_Angeles) as the logical local time
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;

  return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
};



// Add visit
app.post('/api/customers/:customerId/visits', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { customerId } = req.params;
    const { date, purpose, notes, outcome, followUp, followUpDate, managerComment, headquartersComment, image } = req.body;



    // Process date
    const processedDate = ensureDateString(date);


    if (!processedDate || !purpose) {
      return res.status(400).json({ message: 'Date and purpose are required' });
    }

    // Check if customer exists and get necessary info in one query
    const customerInfo = await Customer.findById(customerId).select('contactName company').lean();
    if (!customerInfo) {
      console.error(`[Add Visit] Customer not found: ${customerId}`);
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Get creator information based on auth type
    const { id: createdBy, name: createdByName } = await getPerformerInfo(req);

    // Get the customer's contact name (the customer being visited)
    const customerContactName = customerInfo.company || customerInfo.contactName || '';

    // Process images: Convert base64 to optimized disk files
    let processedImage = image;
    if (Array.isArray(image)) {
      processedImage = await Promise.all(image.map(img => processBase64Image(img, 'visits')));
    } else if (typeof image === 'string') {
      processedImage = await processBase64Image(image, 'visits');
    }

    // Pre-generate visit ID for atomic update and logging
    const visitId = new mongoose.Types.ObjectId();
    const visitData = {
      _id: visitId,
      date: ensureDateString(date),
      purpose,
      notes,
      outcome,
      followUp,
      followUpDate: ensureDateString(followUpDate),
      managerComment,
      headquartersComment,
      image: processedImage,
      createdBy,
      createdByName,
      customerContactName,
      createdAt: getNowLocalISO()
    };

    // Use atomic $push to add the visit
    const updateStart = Date.now();
    const result = await Customer.updateOne(
      { _id: customerId },
      { $push: { visits: visitData } }
    );

    if (result.matchedCount === 0) {
      console.error(`[Add Visit] Atomic update matched zero docs for customer: ${customerId}`);
      return res.status(404).json({ message: 'Customer not found during update' });
    }

    console.log(`[Add Visit] Success in ${Date.now() - updateStart}ms for customer ${customerId}`);
    req.app.get('io').emit('visit_updated', { customerId });
    res.status(201).json({ success: true, visit: visitData });

    // Background: put the visit on the logger's calendar — completing their
    // own Scheduled entry for this customer that day, or adding a drop-in if
    // they had nothing planned (see src/services/visitSchedule.js). Matched on
    // the date prefix, not a Date-object comparison — startTime is stored as
    // a naive '<date>T...' local string (see the calendar-sync timezone fix).
    // Only 'Scheduled' entries are completed, so this can't resurrect a
    // Cancelled stop or relink an already-Completed one.
    try {
      await linkVisitToSchedule({
        customerId, visitId, visitDate: processedDate,
        userId: req.authType === 'admin' ? createdBy : null,
        purpose, emit: emitScheduleUpdate
      });
    } catch (linkError) {
      console.error('Failed to link visit to schedule:', linkError);
    }

    // Background: Log the activity
    try {
      await ActivityLog.create({
        entityType: 'Visit',
        entityId: visitId,
        customerId: customerId,
        action: 'CREATE',
        performedBy: createdBy,
        performedByName: createdByName,
        performedByRole: req.authType,
        timestamp: getNowLocalISO(),
        details: { purpose: visitData.purpose, date: visitData.date }
      });
    } catch (logError) {
      console.error('Failed to log visit creation:', logError);
    }
  } catch (error) {
    console.error('Add visit error:', error);
    res.status(500).json({ message: 'Failed to add visit: ' + error.message });
  }
});

// Update visit
// Update visit
app.put('/api/customers/:customerId/visits/:visitId', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { customerId, visitId } = req.params;
    const { date, purpose, notes, outcome, followUp, followUpDate, managerComment, headquartersComment, image } = req.body;

    // Get updater information
    // Get updater information
    const { id: updatedBy, name: updatedByName } = await getPerformerInfo(req);

    const updateData = {};
    if (date) updateData['visits.$.date'] = ensureDateString(date);
    if (purpose !== undefined) updateData['visits.$.purpose'] = purpose;
    if (notes !== undefined) updateData['visits.$.notes'] = notes;
    if (outcome !== undefined) updateData['visits.$.outcome'] = outcome;
    if (followUp !== undefined) updateData['visits.$.followUp'] = followUp;
    if (followUpDate !== undefined) updateData['visits.$.followUpDate'] = ensureDateString(followUpDate);
    if (managerComment !== undefined) updateData['visits.$.managerComment'] = managerComment;
    if (headquartersComment !== undefined) updateData['visits.$.headquartersComment'] = headquartersComment;
    if (image !== undefined) {
      let processedImage = image;
      if (Array.isArray(image)) {
        processedImage = await Promise.all(image.map(img => processBase64Image(img, 'visits')));
      } else if (typeof image === 'string') {
        processedImage = await processBase64Image(image, 'visits');
      }
      updateData['visits.$.image'] = processedImage;
    }

    // Add tracking fields
    updateData['visits.$.updatedBy'] = updatedBy;
    updateData['visits.$.updatedByName'] = updatedByName;
    updateData['visits.$.updatedAt'] = getNowLocalISO();

    // Read before the write: whether the date is changing, and who logged
    // the visit — its calendar entry belongs to them, not to whoever edits it.
    const before = updateData['visits.$.date']
      ? (await Customer.findOne({ _id: customerId, 'visits._id': visitId }, { 'visits.$': 1 }).lean())?.visits?.[0]
      : null;

    const result = await Customer.updateOne(
      { _id: customerId, 'visits._id': visitId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or visit not found' });
    }

    res.json({ success: true, message: 'Visit updated successfully' });

    // Background: a visit moved to another day takes its calendar entry along.
    if (before && before.date !== updateData['visits.$.date']) {
      try {
        await moveVisitOnSchedule({
          customerId, visitId, newDate: updateData['visits.$.date'],
          userId: before.createdBy, purpose: purpose ?? before.purpose, emit: emitScheduleUpdate
        });
      } catch (moveError) {
        console.error('Failed to move visit on schedule:', moveError);
      }
    }

    // Background: Log the activity
    try {
      await ActivityLog.create({
        entityType: 'Visit',
        entityId: visitId,
        customerId: customerId,
        action: 'UPDATE',
        performedBy: updatedBy,
        performedByName: updatedByName,
        performedByRole: req.authType,
        timestamp: getNowLocalISO(),
        details: { fields: Object.keys(req.body) }
      });
    } catch (logError) {
      console.error('Failed to log visit update:', logError);
    }
  } catch (error) {
    console.error('Update visit error:', error);
    res.status(500).json({ message: 'Failed to update visit' });
  }
});

// Delete visit
// Delete visit
app.delete('/api/customers/:customerId/visits/:visitId', authenticate, requireAnyPermission('manage_customers', 'delete_customers'), async (req, res) => {
  try {
    const { customerId, visitId } = req.params;

    // Get performer information
    // Get performer information
    const { id: performedBy, name: performedByName } = await getPerformerInfo(req);

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const visit = customer.visits ? customer.visits.id(visitId) : null;
    const isResourcePlacement = visit && visit.purpose && visit.purpose.toLowerCase().includes('resource placement');
    const purposeText = visit ? visit.purpose.replace(/^Resource Placement:\s*/i, '').trim() : '';

    // Remove the visit
    customer.visits.pull({ _id: visitId });

    // If deleting a Resource Placement visit, also clean up the corresponding resource entry
    if (isResourcePlacement && purposeText && customer.resources && customer.resources.length > 0) {
      const matchingResourceIndex = customer.resources.findIndex(r => 
        (r.title && r.title.toLowerCase() === purposeText.toLowerCase()) ||
        (r.resourceType && r.resourceType.toLowerCase() === purposeText.toLowerCase())
      );
      if (matchingResourceIndex > -1) {
        customer.resources.splice(matchingResourceIndex, 1);
      }
    }

    await customer.save();

    res.json({ success: true, message: 'Visit deleted successfully' });

    // Background: its drop-in comes off the calendar; a planned entry it had
    // completed goes back to Scheduled.
    try {
      await unlinkVisitFromSchedule({ visitId, emit: emitScheduleUpdate });
    } catch (unlinkError) {
      console.error('Failed to unlink visit from schedule:', unlinkError);
    }

    // Background: Log the activity
    try {
      await ActivityLog.create({
        entityType: 'Visit',
        entityId: visitId,
        customerId: customerId,
        action: 'DELETE',
        performedBy: performedBy,
        performedByName: performedByName,
        performedByRole: req.authType,
        details: { visitDate: visit ? visit.date : null, purpose: visit ? visit.purpose : null }
      });
    } catch (logError) {
      console.error('Failed to log visit deletion:', logError);
    }
  } catch (error) {
    console.error('Delete visit error:', error);
    res.status(500).json({ message: 'Failed to delete visit' });
  }
});

// ── CALENDAR / SCHEDULE ──
// Lives in src/routes/schedule.js: planner entries, the route planner's bulk
// writes, the .ics feed, and Google/iCloud sync. emitScheduleUpdate is created
// here because the visit routes above announce calendar changes too.
const emitScheduleUpdate = createScheduleEmitter(io);
app.use('/api', createScheduleRouter({
  authenticate,
  requirePermission,
  emitScheduleUpdate,
  jwtSecret: JWT_SECRET
}));

// ── DAILY WORK REPORT ──
// Lives in src/routes/dailyReports.js rather than here — a self-contained
// feature with its own model, handed the middleware it needs.
app.use('/api/daily-reports', createDailyReportsRouter({
  authenticate,
  requirePermission
}));

// ── MANIFEST DISPATCH SCHEDULER ENDPOINTS (MongoDB Persisted) ──
// Lives in src/routes/deliveries.js rather than here — a self-contained
// feature with its own model, handed the middleware and generic
// cross-feature helpers it needs, same pattern as /api/daily-reports above.
// Mounted at '/api' since the router also owns GET/POST /api/trucks.
app.use('/api', createDeliveriesRouter({
  authenticate,
  requirePermission,
  requireAnyPermission,
  getPerformerInfo,
  // Indirected, not passed directly: processBase64Images is a `const`
  // defined much later in this file (after most routes), so referencing its
  // value here — at this line's own evaluation time, not inside a request
  // handler — would hit the temporal dead zone before it's initialized. This
  // arrow function only reads it when actually called, by which point the
  // whole module has finished loading.
  processBase64Images: (...args) => processBase64Images(...args),
  getNowLocalISO
}));

// Office check-in / visitor log. Lives in src/routes/checkIn.js, same
// reasoning as the daily-reports and deliveries routers above. Mounted at
// '/api/checkin' — every route in that file is relative to this prefix.
app.use('/api/checkin', createCheckInRouter({ authenticate, requirePermission }));


// Toggle reaction on visit
app.post('/api/customers/:customerId/visits/:visitId/react', authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const { customerId, visitId } = req.params;
    const { type } = req.body;

    // Get user info from auth middleware
    // verifyAnyAuth sets userId (for admin) or customerId (for customer)
    // and authType ('admin' or 'customer')
    const userId = req.userId || req.customerId;
    const isCustomer = req.authType !== 'admin';

    let userName = 'Unknown';
    if (!isCustomer) {
      const user = await User.findById(userId);
      userName = user ? displayNameOf(user) : 'Admin';
    } else {
      const customer = await Customer.findById(userId);
      userName = customer ? (customer.contactName || customer.email) : 'Customer';
    }

    // Find the customer and specific visit
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const visit = customer.visits.id(visitId);
    if (!visit) {
      return res.status(404).json({ message: 'Visit not found' });
    }

    // Initialize reactions array if it doesn't exist (legacy support)
    if (!visit.reactions) {
      visit.reactions = [];
    }

    // Check if user already reacted with this type
    const existingIndex = visit.reactions.findIndex(
      r => r.userId === userId.toString() && r.type === type
    );

    if (existingIndex > -1) {
      // Remove reaction (toggle off)
      visit.reactions.splice(existingIndex, 1);
    } else {
      // Add reaction (toggle on)
      // Optionally remove other reactions by same user if we want single-reaction logic
      // But requested feature implies "Like", "Love", etc. which could theoretically co-exist,
      // though typically mutually exclusive. Let's make them mutually exclusive for simplicity.
      const otherReactionIndex = visit.reactions.findIndex(r => r.userId === userId.toString());
      if (otherReactionIndex > -1) {
        visit.reactions.splice(otherReactionIndex, 1);
      }

      visit.reactions.push({
        type,
        userId: userId.toString(),
        userName,
        createdAt: getNowLocalISO()
      });
    }

    await customer.save();

    res.json({
      success: true,
      message: 'Reaction updated',
      reactions: visit.reactions
    });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ message: 'Failed to update reaction' });
  }
});

// ============================================
// RESOURCES CRUD ENDPOINTS
// ============================================

// Add resource
app.post('/api/customers/:customerId/resources', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { customerId } = req.params;
    const { title, date, customer, location, resourceType, image, description, notes, status, url, uploadedBy } = req.body;

    // If title is missing but resourceType is present, use resourceType as title
    const finalTitle = title || resourceType;

    if (!finalTitle) {
      return res.status(400).json({ message: 'Resource title or type is required' });
    }

    // Get performer and customer info for both resource and visit posting
    const performer = await getPerformerInfo(req);
    const customerDoc = await Customer.findById(customerId).select('contactName company').lean();

    if (!customerDoc) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Process images (convert base64 to Cloudinary URLs)
    const processedImages = await processBase64Images(image, 'Resources');

    const resourceDateStr = ensureDateString(date || new Date());

    const newResource = {
      title: finalTitle,
      date: resourceDateStr,
      customer: customer || customerDoc.company || customerDoc.contactName || '',
      location: location || '',
      resourceType: resourceType || '',
      image: processedImages,
      description: description || '',
      notes: notes || '',
      status: status || 'Active',
      url: url || '',
      uploadedBy: uploadedBy || performer.id,
      createdAt: getNowLocalISO()
    };

    // Auto-generate a corresponding Visit entry for customer history
    const visitPurpose = resourceType ? `Resource Placement: ${resourceType}` : `Resource Placement: ${finalTitle}`;
    const visitNotes = notes || description || `Added resource: ${finalTitle}`;
    const customerContactName = customerDoc.company || customerDoc.contactName || '';

    const newVisit = {
      _id: new mongoose.Types.ObjectId(),
      date: resourceDateStr,
      purpose: visitPurpose,
      notes: visitNotes,
      outcome: '',
      followUp: false,
      followUpDate: null,
      image: processedImages,
      createdBy: performer.id,
      createdByName: performer.name,
      customerContactName: customerContactName,
      createdAt: getNowLocalISO()
    };

    const result = await Customer.updateOne(
      { _id: customerId },
      { 
        $push: { 
          resources: newResource,
          visits: newVisit
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.status(201).json({ success: true, resource: newResource, visit: newVisit });

    // Background: a placement is a stop like any other visit — on the
    // logger's calendar as a Drop-off (see src/services/visitSchedule.js).
    try {
      await linkVisitToSchedule({
        customerId, visitId: newVisit._id, visitDate: resourceDateStr,
        userId: req.authType === 'admin' ? performer.id : null,
        purpose: visitPurpose, emit: emitScheduleUpdate
      });
    } catch (linkError) {
      console.error('Failed to link resource visit to schedule:', linkError);
    }
  } catch (error) {
    console.error('Add resource error:', error);
    res.status(500).json({ message: `Failed to add resource: ${error.message}` });
  }
});

// Update resource
app.put('/api/customers/:customerId/resources/:resourceId', authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;
    const updateData = {};
    const fields = { ...req.body };

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const existingResource = customer.resources ? customer.resources.id(resourceId) : null;
    const oldTitle = existingResource ? (existingResource.title || existingResource.resourceType) : '';

    // Process images if they are being updated
    if (fields.image) {
      fields.image = await processBase64Images(fields.image, 'Resources');
    }

    /**
     * Re-pointing a resource at a different customer.
     *
     * A resource is a subdocument of the customer that holds it, so correcting
     * one that was filed against the wrong account is a move between two
     * documents, not a field update. The client PUTs to the customer it should
     * belong to, so when it is not there, find who actually holds it and carry
     * it across — keeping its _id, so anything pointing at this resource still
     * resolves. Before this, that edit answered "Customer or resource not
     * found" and the mistake could not be corrected at all.
     */
    if (!existingResource) {
      const source = await Customer.findOne({ 'resources._id': resourceId });
      const moving = source ? source.resources.id(resourceId) : null;

      if (!moving) {
        return res.status(404).json({ message: 'Customer or resource not found' });
      }

      const carried = moving.toObject();
      Object.keys(fields).forEach(key => {
        if (key === 'date') carried[key] = ensureDateString(fields[key]);
        else if (key !== '_id') carried[key] = fields[key];
      });
      if (fields.resourceType && !fields.title) carried.title = fields.resourceType;

      moving.deleteOne();
      await source.save();

      customer.resources.push(carried);
      await customer.save();

      req.app.get('io')?.emit('customer_update');
      console.log(`↔️ Resource ${resourceId} moved from ${source.company || source._id} to ${customer.company || customer._id}`);
      return res.json({ success: true, message: 'Resource moved to the selected customer', moved: true });
    }

    Object.keys(fields).forEach(key => {
      // If title is missing but resourceType is present, use resourceType as title
      if (key === 'resourceType' && !fields.title) {
        updateData['resources.$.title'] = fields[key];
      }
      // Ensure date fields are properly formatted as YYYY-MM-DD strings
      if (key === 'date') {
        updateData[`resources.$.${key}`] = ensureDateString(fields[key]);
      } else {
        updateData[`resources.$.${key}`] = fields[key];
      }
    });

    const result = await Customer.updateOne(
      { _id: customerId, 'resources._id': resourceId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or resource not found' });
    }

    // Synchronize: Also update the associated Visit entry if found
    if (customer.visits && customer.visits.length > 0 && oldTitle) {
      const matchingVisit = customer.visits.find(v => 
        v.purpose && (
          v.purpose.includes(oldTitle) || 
          (existingResource && existingResource.resourceType && v.purpose.includes(existingResource.resourceType))
        )
      );

      if (matchingVisit) {
        const newTitle = fields.title || fields.resourceType || oldTitle;
        const newPurpose = `Resource Placement: ${newTitle}`;
        const visitUpdateData = {
          'visits.$.purpose': newPurpose
        };

        if (fields.date) visitUpdateData['visits.$.date'] = ensureDateString(fields.date);
        if (fields.notes !== undefined || fields.description !== undefined) {
          visitUpdateData['visits.$.notes'] = fields.notes || fields.description || `Added resource: ${newTitle}`;
        }
        if (fields.image) visitUpdateData['visits.$.image'] = fields.image;

        await Customer.updateOne(
          { _id: customerId, 'visits._id': matchingVisit._id },
          { $set: visitUpdateData }
        );

        // Its calendar entry follows the visit to its new day.
        const newDate = visitUpdateData['visits.$.date'];
        if (newDate && newDate !== matchingVisit.date) {
          try {
            await moveVisitOnSchedule({
              customerId, visitId: matchingVisit._id, newDate,
              userId: matchingVisit.createdBy, purpose: newPurpose, emit: emitScheduleUpdate
            });
          } catch (moveError) {
            console.error('Failed to move resource visit on schedule:', moveError);
          }
        }
      }
    }

    res.json({ success: true, message: 'Resource updated successfully' });
  } catch (error) {
    console.error('Update resource error:', error);
    res.status(500).json({ message: 'Failed to update resource' });
  }
});

// Delete resource
app.delete('/api/customers/:customerId/resources/:resourceId', authenticate, requireAnyPermission('manage_customers', 'delete_customers'), async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const resource = customer.resources ? customer.resources.id(resourceId) : null;
    const titleToMatch = resource ? (resource.title || resource.resourceType) : '';

    // Remove the resource
    customer.resources.pull({ _id: resourceId });

    // Synchronize: Also remove the linked auto-generated Visit entry if it exists
    let removedVisitId = null;
    if (titleToMatch && customer.visits && customer.visits.length > 0) {
      const matchingVisitIndex = customer.visits.findIndex(v =>
        v.purpose && (
          v.purpose.includes(titleToMatch) ||
          (resource.resourceType && v.purpose.includes(resource.resourceType))
        )
      );
      if (matchingVisitIndex > -1) {
        removedVisitId = customer.visits[matchingVisitIndex]._id;
        customer.visits.splice(matchingVisitIndex, 1);
      }
    }

    await customer.save();

    res.json({ success: true, message: 'Resource deleted successfully' });

    // Background: the auto-generated visit is gone, so its calendar entry goes too.
    if (removedVisitId) {
      try {
        await unlinkVisitFromSchedule({ visitId: removedVisitId, emit: emitScheduleUpdate });
      } catch (unlinkError) {
        console.error('Failed to unlink resource visit from schedule:', unlinkError);
      }
    }
  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({ message: 'Failed to delete resource' });
  }
});

// ============================================
// CUSTOMER IMPORT (Excel)
// ============================================

/**
 * The reference data an import is judged against: the branches that exist, the
 * people who may own an account, and the customers already held.
 *
 * Branches are keyed case- and punctuation-insensitively but stored in the
 * collection's own casing, so 'salt lake city' and 'SALT LAKE CITY ' both file
 * under 'Salt Lake City' rather than creating look-alike branches.
 *
 * Reps are keyed on every name a person goes by in a sheet — display name,
 * username, tidied username, email — and drawn from the same isSalesRep rule
 * the Sales Rep dropdown uses, so a name the form would not offer is not one an
 * import can assign either.
 */
const loadImportReferenceData = async () => {
  const branchByKey = new Map(
    (await Location.find().select('name').lean()).map(b => [importNormalize(b.name), b.name])
  );

  const repByKey = new Map();
  for (const u of (await User.find().select('username displayName email role').lean()).filter(isSalesRep)) {
    const resolved = { salesRep: u._id, salesRepName: displayNameOf(u) };
    for (const alias of [u.displayName, u.username, prettifyUsername(u.username), u.email]) {
      const key = importNormalize(alias);
      if (key && !repByKey.has(key)) repByKey.set(key, resolved);
    }
  }

  // quickNote is here for the "fill blanks only" update (buildImportPlan's
  // planUpdate), which has to see what the record already holds.
  const existing = await Customer.find(
    {},
    'company contactName email phone address quickNote salesRep salesRepName location isActive createdAt notDuplicateOf'
  ).lean();

  return { branchByKey, repByKey, existing };
};

/**
 * Plan an import from an uploaded file.
 *
 * Both the preview and the apply call this. Apply re-reads the same file and
 * rebuilds the plan against the database as it stands at that moment, rather
 * than trusting a plan the browser hands back — so a customer added between the
 * two calls is still matched, and nothing the client edits can decide which
 * record gets written.
 */
const planCustomerImport = async (req) => {
  // An absent field parses to {}, which every consumer reads as "nothing was
  // overridden" — the same answer as not asking.
  const parse = (field) => (req.body[field] ? JSON.parse(req.body[field]) : {});
  const { headers, rows } = await runWorkbookParse('customer', req.file.buffer);
  const mapping = resolveImportMapping(headers, parse('mapping'));
  const reference = await loadImportReferenceData();
  const memory = await ImportMemory.findOne({ kind: 'customer' }).lean();
  // A lean() Map field can come back as either, depending on the driver.
  const asObject = (m) => (m instanceof Map ? Object.fromEntries(m) : (m || {}));
  const savedReps = asObject(memory?.repAliases);
  const savedBranches = asObject(memory?.branchAliases);

  // Captured before any alias is folded in, so the "remembered" counts below
  // only count names that were answered from memory, not real users.
  const realRepKeys = new Set(reference.repByKey.keys());
  const realBranchKeys = new Set(reference.branchByKey.keys());

  // What the admin said the sheet's unrecognised names mean: 'Stephen Watson'
  // is this user id, 'PDX' is this branch. Folded into the same lookups the
  // automatic matching uses, so an alias resolves exactly like a real name —
  // and an alias naming someone who cannot own accounts resolves to nothing,
  // because only people already in these maps can be named at all.
  //
  // Remembered answers go in first and only for names no real user answers
  // to (if "Jeremy Earnest" later gets an account, that account wins); this
  // upload's own answers go in after and override both. false / '' are the
  // "decided: nobody" answers buildImportPlan stops asking about.
  const repById = new Map([...reference.repByKey.values()].map(r => [String(r.salesRep), r]));
  const resolveRep = (userId) => (userId === '' || userId === IMPORT_UNASSIGNED ? false : repById.get(String(userId)));
  for (const [key, userId] of Object.entries(savedReps)) {
    if (reference.repByKey.has(key)) continue;
    const rep = resolveRep(userId);
    if (rep !== undefined) reference.repByKey.set(key, rep);
  }
  for (const [given, userId] of Object.entries(parse('repAliases'))) {
    const rep = resolveRep(userId);
    if (rep !== undefined) reference.repByKey.set(importNormalize(given), rep);
  }

  const branches = [...new Set(reference.branchByKey.values())];
  const resolveBranch = (branch) => (branch === '' || branch === IMPORT_DEFAULT_BRANCH ? '' : (branches.includes(branch) ? branch : undefined));
  for (const [key, branch] of Object.entries(savedBranches)) {
    if (reference.branchByKey.has(key)) continue;
    const resolved = resolveBranch(branch);
    if (resolved !== undefined) reference.branchByKey.set(key, resolved);
  }
  for (const [given, branch] of Object.entries(parse('branchAliases'))) {
    const resolved = resolveBranch(branch);
    if (resolved !== undefined) reference.branchByKey.set(importNormalize(given), resolved);
  }

  const plan = buildImportPlan({
    headers, rows, mapping, ...reference,
    decisions: parse('decisions'),
    decisionsByKey: asObject(memory?.decisions)
  });

  // How many of this sheet's names were answered from memory, for the
  // preview's "using saved choices" line.
  const sheetKeys = (field) => new Set(rows.map(r => importNormalize(mapping[field] ? r[mapping[field]] : '')).filter(Boolean));
  const countRemembered = (field, realKeys, saved) =>
    [...sheetKeys(field)].filter(k => !realKeys.has(k) && Object.prototype.hasOwnProperty.call(saved, k)).length;

  return {
    ...plan,
    existing: reference.existing,
    branches,
    reps: [...repById]
      .map(([id, r]) => ({ _id: id, name: r.salesRepName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    remembered: {
      reps: countRemembered('salesRep', realRepKeys, savedReps),
      branches: countRemembered('location', realBranchKeys, savedBranches),
      decisions: plan.rememberedDecisionsUsed
    }
  };
};

/**
 * File this upload's answers for next time — called only after an apply, so
 * nothing the admin was still trying out in the preview gets remembered.
 *
 * A review decision is filed as the customer id it resolved to, never as
 * 'create': the business 'create' made exists now, and next month's export of
 * the same row should update it rather than make it again. Only decisions the
 * plan actually honoured are filed — one naming a record the row didn't match
 * was ignored by buildImportPlan, and is ignored here too.
 */
const saveImportMemory = async (req, plan, createdByRow) => {
  const parse = (field) => (req.body[field] ? JSON.parse(req.body[field]) : {});
  const repIds = new Set(plan.reps.map(r => String(r._id)));
  const set = {};

  for (const [given, userId] of Object.entries(parse('repAliases'))) {
    const key = importNormalize(given);
    if (!key) continue;
    if (userId === IMPORT_UNASSIGNED) set[`repAliases.${key}`] = '';
    else if (repIds.has(String(userId))) set[`repAliases.${key}`] = String(userId);
  }
  for (const [given, branch] of Object.entries(parse('branchAliases'))) {
    const key = importNormalize(given);
    if (!key) continue;
    if (branch === IMPORT_DEFAULT_BRANCH) set[`branchAliases.${key}`] = '';
    else if (plan.branches.includes(branch)) set[`branchAliases.${key}`] = branch;
  }

  const byRow = new Map(plan.planned.map(p => [p.rowNumber, p]));
  for (const [rowNumber, choice] of Object.entries(parse('decisions'))) {
    const row = byRow.get(Number(rowNumber));
    if (!row?.rowKey) continue;
    const id = choice === 'create'
      ? createdByRow.get(row.rowNumber)
      : (row.targetId === String(choice) ? row.targetId : null);
    if (id) set[`decisions.${row.rowKey}`] = String(id);
  }

  if (!Object.keys(set).length) return;
  await ImportMemory.updateOne(
    { kind: 'customer' },
    { $set: { ...set, updatedBy: req.user?.username || '' } },
    { upsert: true }
  );
};

/**
 * Duplicates already sitting in the database, independent of any sheet — the
 * audit script's findings, surfaced where the person holding the spreadsheet
 * can act on them. Only groups where two independent signals agree; below that
 * a group is a question, not a finding, and the list stops being worth reading.
 */
const existingDuplicateReport = (existing) => {
  const byId = new Map(existing.map(c => [String(c._id), c]));
  // Pairs someone already said are separate accounts drop out, so a group
  // only shows what's still undecided.
  const separatedFrom = new Map(existing.map(c => [String(c._id), new Set((c.notDuplicateOf || []).map(String))]));
  return groupDuplicates(existing)
    .filter(g => g.score >= STRONG)
    .map(g => ({ ...g, ids: withoutSeparated(g.ids, separatedFrom) }))
    .filter(g => g.ids.length > 1)
    .slice(0, 100)
    .map(g => ({
      signals: g.signals,
      score: g.score,
      // Oldest first: that's the record the team has most likely been using,
      // so it's the screen's default "keep" — same tie-break the merge script uses.
      members: g.ids
        .map(id => byId.get(id))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(c => ({
          id: String(c._id),
          label: importLabel(c),
          createdAt: c.createdAt,
          salesRepName: c.salesRepName || ''
        }))
    }));
};

/**
 * Settle one duplicate group from the import screen: `keepId` stays, and
 * every other member is either merged into it, deleted, or marked a separate
 * account.
 *
 * Merge and delete both go through src/services/customerMerge.js — the same
 * code as the merge script — and both move the removed record's deliveries,
 * bookings, lost sales and activity onto the kept one, since those point at
 * a customer id and would otherwise point at nobody. Merge additionally fills
 * the kept record's blanks and carries over contacts, visits and resources;
 * delete leaves the kept record exactly as it was.
 *
 * Everything touched is snapshotted to customermergebackups first, and the
 * response carries its id for the Undo button.
 */
app.post('/api/admin/customers/duplicates/resolve', verifyToken, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { keepId, actions } = req.body || {};
    const entries = Object.entries(actions || {});
    const VALID = ['merge', 'delete', 'separate'];
    if (!keepId || !entries.length || entries.some(([id, a]) => !VALID.includes(a) || id === keepId)) {
      return res.status(400).json({ message: 'Choose a record to keep, and merge, delete or keep separate for each of the others.' });
    }
    // Removing a customer — by merge or by delete — is what delete_customers
    // exists to gate, same as the Customers page's own Delete button.
    const removing = entries.filter(([, a]) => a !== 'separate').map(([id]) => id);
    if (removing.length && !req.user.permissions.includes('delete_customers')) {
      return res.status(403).json({ message: 'Merging or deleting a customer needs the delete_customers permission.' });
    }

    const db = mongoose.connection.db;
    const ids = [keepId, ...entries.map(([id]) => id)];
    if (!ids.every(id => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: 'Unknown customer id' });
    }
    const docs = await db.collection('customers')
      .find({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } }).toArray();
    const byId = new Map(docs.map(d => [String(d._id), d]));
    const missing = ids.find(id => !byId.has(id));
    if (missing) {
      return res.status(409).json({ message: 'One of these customers no longer exists — refresh the preview.' });
    }

    const survivor = byId.get(keepId);
    const merging = entries.filter(([, a]) => a === 'merge').map(([id]) => byId.get(id));
    const deleting = entries.filter(([, a]) => a === 'delete').map(([id]) => byId.get(id));
    const separate = entries.filter(([, a]) => a === 'separate').map(([id]) => id);
    const who = req.user?.username || '';
    const undoIds = [];

    // Delete runs first and the merge snapshots after it, so an undo of the
    // merge restores the survivor as it was after the delete — the two undo
    // in reverse order and each puts back exactly what it changed.
    if (deleting.length) {
      const snap = await snapshotMerge(db, survivor, deleting);
      const backup = await CustomerMergeBackup.create({ group: snap, action: 'delete', createdBy: who });
      await executeMerge(db, survivor, deleting, { copyDetails: false });
      undoIds.push(String(backup._id));
    }
    if (merging.length) {
      const current = await db.collection('customers').findOne({ _id: survivor._id });
      const { set } = planFields(current, merging);
      const newContacts = contactsFromLosers(set.email ?? current.email, current, merging);
      const snap = await snapshotMerge(db, current, merging);
      const backup = await CustomerMergeBackup.create({ group: snap, action: 'merge', createdBy: who });
      await executeMerge(db, current, merging, { set, newContacts, copyDetails: true });
      undoIds.push(String(backup._id));
    }
    // "These are all different accounts" — the kept one and every member
    // marked separate, each pair recorded, so none of them is asked about again.
    if (separate.length) await markSeparate(db, [keepId, ...separate]);

    req.app.get('io')?.emit('customer_update');
    res.json({
      success: true,
      merged: merging.length,
      deleted: deleting.length,
      separate: separate.length,
      undoIds
    });
  } catch (error) {
    console.error('Resolve duplicate customers error:', error);
    res.status(500).json({ message: `Could not resolve these duplicates: ${error.message}` });
  }
});

// Put back what one resolve removed. Undone newest first, so a merge that
// followed a delete in the same click is reversed before the delete is.
app.post('/api/admin/customers/duplicates/undo', verifyToken, requirePermission('manage_customers', 'delete_customers'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.undoIds) ? req.body.undoIds : [];
    if (!ids.length || !ids.every(id => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: 'Nothing to undo' });
    }
    // By _id, not createdAt: both backups from one click can share a millisecond.
    const backups = await CustomerMergeBackup.find({ _id: { $in: ids }, undoneAt: null }).sort({ _id: -1 });
    if (backups.length !== ids.length) {
      return res.status(409).json({ message: 'This has already been undone.' });
    }
    const db = mongoose.connection.db;
    for (const b of backups) {
      await undoMerge(db, b.group);
      b.undoneAt = new Date();
      await b.save();
    }
    req.app.get('io')?.emit('customer_update');
    res.json({ success: true, restored: backups.reduce((n, b) => n + (b.group.losers?.length || 0), 0) });
  } catch (error) {
    console.error('Undo duplicate resolve error:', error);
    res.status(500).json({ message: `Undo failed: ${error.message}` });
  }
});

// Preview an import: parse, match, and report what would happen. Writes nothing.
app.post('/api/admin/customers/import/preview', verifyToken, requirePermission('manage_customers'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const plan = await planCustomerImport(req);
    res.json({
      success: true,
      headers: plan.headers,
      fields: IMPORT_FIELDS,
      mapping: plan.mapping,
      counts: plan.counts,
      totalRows: plan.totalRows,
      rows: importRowsForClient(plan.planned),
      unresolvedReps: plan.unresolvedReps,
      unresolvedBranches: plan.unresolvedBranches,
      reps: plan.reps,
      branches: plan.branches,
      remembered: plan.remembered,
      dbDuplicates: existingDuplicateReport(plan.existing)
    });
  } catch (error) {
    console.error('Customer import preview error:', error);
    res.status(400).json({ message: `Preview failed: ${error.message}` });
  }
});

// Forget every remembered rep mapping, branch mapping and review decision —
// the way back from one that turned out wrong, since a remembered answer
// stops being asked about and so has no dropdown left to change it in.
app.delete('/api/admin/customers/import/memory', verifyToken, requirePermission('manage_customers'), async (req, res) => {
  try {
    await ImportMemory.deleteOne({ kind: 'customer' });
    res.json({ success: true });
  } catch (error) {
    console.error('Customer import memory reset error:', error);
    res.status(500).json({ message: `Could not forget saved choices: ${error.message}` });
  }
});

/**
 * Carry out an import. Rows flagged for review are never written — that is the
 * whole point of flagging them.
 */
app.post('/api/admin/customers/import/apply', verifyToken, requirePermission('manage_customers'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const plan = await planCustomerImport(req);
    const results = { created: 0, updated: 0, skipped: 0, errors: [] };
    // rowNumber → new customer id, so a "create it" review decision can be
    // remembered as the record it made (see saveImportMemory).
    const createdByRow = new Map();

    for (const row of plan.planned) {
      try {
        if (row.action === 'create') {
          const saved = await new Customer({
            ...row.create,
            password: await bcrypt.hash('Welcome123!', 10)
          }).save();
          createdByRow.set(row.rowNumber, String(saved._id));
          results.created++;
        } else if (row.action === 'update') {
          await Customer.updateOne({ _id: row.targetId }, { $set: row.apply });
          results.updated++;
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.errors.push(`Row ${row.rowNumber} (${row.label || ''}): ${err.message}`);
      }
    }

    // The customers above are already written, so failing to remember the
    // answers must not report the import itself as failed — it only means
    // the next upload asks again.
    try {
      await saveImportMemory(req, plan, createdByRow);
    } catch (err) {
      console.error('Customer import memory save error:', err);
      results.errors.push(`Your rep mappings and review decisions could not be saved for next time: ${err.message}`);
    }

    res.json({
      success: true,
      results,
      counts: plan.counts,
      rows: importRowsForClient(plan.planned),
      unresolvedReps: plan.unresolvedReps,
      unresolvedBranches: plan.unresolvedBranches,
      dbDuplicates: existingDuplicateReport(plan.existing)
    });
  } catch (error) {
    console.error('Customer import apply error:', error);
    res.status(400).json({ message: `Import failed: ${error.message}` });
  }
});

// ERP import — scrapes the ERP's web UI directly via Playwright (no API
// available). Returns rows for review only; nothing here writes to Mongo,
// since erpImportService.js's selectors are still placeholders pending the
// real ERP's markup. Wiring the reviewed rows into Customer/Product/sales
// writes is follow-up work, same shape as /api/admin/customers/import/apply
// above.
app.post('/api/admin/erp-import/:type', authenticate, requirePermission('manage_customers'), async (req, res) => {
  const scrapers = {
    customers: scrapeErpCustomers,
    inventory: scrapeErpInventory,
    sales: scrapeErpSales
  };
  const scrape = scrapers[req.params.type];
  if (!scrape) return res.status(400).json({ message: `Unknown import type: ${req.params.type}` });

  try {
    const rows = await scrape();
    res.json({ success: true, count: rows.length, rows });
  } catch (error) {
    console.error('ERP import error:', error);
    res.status(500).json({ message: `ERP import failed: ${error.message}` });
  }
});

// ============================================
// INVENTORY ANALYSIS
// ============================================
// Two SPS exports feed this feature (see src/utils/inventoryImport.js):
// - "stock": a full mirror of on-hand slabs/lots, wiped and replaced whole on
//   every import since it's a point-in-time snapshot, not a ledger.
// - "sales": per-product sold totals for a location+date-range period, kept
//   alongside prior periods (re-importing the same period+location replaces
//   just that combination) so velocity/reorder math has something to divide by.

// Shared by /summary and /items so the two never drift apart on what a
// given search/category/location/status combination actually matches.
const buildInventoryItemQuery = ({ search = '', category = '', location = '', status = '', product = '' } = {}) => {
  const query = {};
  if (product) query.product = product;
  if (category) query.category = category;
  if (location) query.location = location;
  if (status === 'available') query.slabStatus = '';
  else if (status) query.slabStatus = status;
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ product: re }, { sku: re }, { supplier: re }, { block: re }, { serialNumber: re }];
  }
  return query;
};

app.get('/api/inventory-analysis/summary', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
  try {
    const filterQuery = buildInventoryItemQuery(req.query);
    const now = new Date();

    // Independent reads against the same collection — run them concurrently
    // instead of five serialized round trips (this fires on every filter
    // change, debounced but still per-keystroke-adjacent).
    const [[totals], byCategory, agingBuckets, distinctProducts, latest] = await Promise.all([
      InventoryItem.aggregate([
        { $match: filterQuery },
        { $group: {
            _id: null,
            totalItems: { $sum: 1 },
            totalAssetValue: { $sum: '$assetValue' },
            totalAvailableQty: { $sum: '$availableQuantity' }
        } }
      ]),
      InventoryItem.aggregate([
        { $match: filterQuery },
        { $group: {
            _id: '$category',
            items: { $sum: 1 },
            assetValue: { $sum: '$assetValue' },
            availableQty: { $sum: '$availableQuantity' }
        } },
        { $sort: { assetValue: -1 } },
        { $project: { _id: 0, category: { $ifNull: ['$_id', 'Uncategorized'] }, items: 1, assetValue: 1, availableQty: 1 } }
      ]),
      InventoryItem.aggregate([
        { $match: { ...filterQuery, receivedDate: { $ne: null } } },
        { $project: {
            assetValue: 1,
            ageDays: { $divide: [{ $subtract: [now, '$receivedDate'] }, 1000 * 60 * 60 * 24] }
        } },
        { $bucket: {
            groupBy: '$ageDays',
            boundaries: [0, 30, 60, 90, 180, 365, Infinity],
            default: 'unknown',
            output: { count: { $sum: 1 }, assetValue: { $sum: '$assetValue' } }
        } }
      ]),
      InventoryItem.distinct('product', filterQuery),
      // "Last synced" always reflects the most recent import overall, not the
      // filtered subset — a filter narrowing to zero rows shouldn't make the
      // sync timestamp disappear.
      InventoryItem.findOne().sort({ importedAt: -1 }).select('importedAt importedByName').lean()
    ]);

    // Asset value is cost-basis data, gated separately from the page itself
    // (view_inventory_analysis) — strip it server-side rather than just
    // hiding it in the UI, since it's sitting right there in the response.
    const canViewPrices = req.user.permissions.includes('view_inventory_prices');

    res.json({
      totalItems: totals?.totalItems || 0,
      totalAssetValue: canViewPrices ? (totals?.totalAssetValue || 0) : null,
      totalAvailableQty: totals?.totalAvailableQty || 0,
      distinctProductCount: distinctProducts.length,
      byCategory: canViewPrices ? byCategory : byCategory.map(({ assetValue, ...rest }) => rest),
      agingBuckets: canViewPrices ? agingBuckets : agingBuckets.map(({ assetValue, ...rest }) => rest),
      lastImportedAt: latest?.importedAt || null,
      lastImportedByName: latest?.importedByName || ''
    });
  } catch (error) {
    console.error('Inventory analysis summary error:', error);
    res.status(500).json({ message: 'Failed to load inventory summary' });
  }
});

app.get('/api/inventory-analysis/filters', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
  try {
    const [categories, locations, statuses] = await Promise.all([
      InventoryItem.distinct('category'),
      InventoryItem.distinct('location'),
      InventoryItem.distinct('slabStatus')
    ]);
    res.json({
      categories: categories.filter(Boolean).sort(),
      locations: locations.filter(Boolean).sort(),
      statuses: statuses.filter(Boolean).sort()
    });
  } catch (error) {
    console.error('Inventory analysis filters error:', error);
    res.status(500).json({ message: 'Failed to load filters' });
  }
});

app.get('/api/inventory-analysis/items', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));
    const query = buildInventoryItemQuery(req.query);

    const [items, total] = await Promise.all([
      InventoryItem.find(query).sort({ receivedDate: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      InventoryItem.countDocuments(query)
    ]);

    const canViewPrices = req.user.permissions.includes('view_inventory_prices');
    const sanitizedItems = canViewPrices
      ? items
      : items.map(({ assetValue, unitFobCost, unitLandedCost, purchaseCost, ...rest }) => rest);

    res.json({ items: sanitizedItems, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    console.error('Inventory analysis items error:', error);
    res.status(500).json({ message: 'Failed to load inventory items' });
  }
});

// Stock Detail, grouped by product — one row per product with rolled-up
// totals instead of one row per slab. Paginated by distinct product (not by
// raw slab count), so a page of 25 always means 25 products regardless of
// how many slabs each has. Expanding a group in the UI re-fetches that
// product's individual slabs from GET /api/inventory-analysis/items?product=…
// rather than shipping every slab of every product up front.
app.get('/api/inventory-analysis/items/grouped', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const filterQuery = buildInventoryItemQuery(req.query);

    const [result] = await InventoryItem.aggregate([
      { $match: filterQuery },
      { $group: {
          _id: '$product',
          category: { $first: '$category' },
          units: { $first: '$units' },
          slabCount: { $sum: 1 },
          totalOnHand: { $sum: '$instockQty' },
          totalAvailable: { $sum: '$availableQuantity' },
          totalAssetValue: { $sum: '$assetValue' },
          locations: { $addToSet: '$location' },
          oldestReceivedDate: { $min: '$receivedDate' },
          statuses: { $push: '$slabStatus' }
      } },
      { $sort: { oldestReceivedDate: 1 } },
      { $facet: {
          data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: 'count' }]
      } }
    ]);

    const canViewPrices = req.user.permissions.includes('view_inventory_prices');
    const groups = (result?.data || []).map(g => {
      // Keys must cover every bucket SLAB_STATUS_BUCKET can return, or that
      // bucket's ++ would land on undefined and ship NaN to the UI.
      const statusCounts = { available: 0, hold: 0, so: 0, pickticket: 0, packinglist: 0, transfer: 0, other: 0 };
      g.statuses.forEach(s => { statusCounts[SLAB_STATUS_BUCKET(s)]++; });
      return {
        product: g._id,
        category: g.category,
        units: g.units,
        slabCount: g.slabCount,
        totalOnHand: g.totalOnHand,
        totalAvailable: g.totalAvailable,
        totalAssetValue: canViewPrices ? g.totalAssetValue : null,
        locations: g.locations.filter(Boolean).sort(),
        oldestReceivedDate: g.oldestReceivedDate,
        statusCounts
      };
    });

    const total = result?.totalCount?.[0]?.count || 0;
    res.json({ groups, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    console.error('Inventory analysis grouped items error:', error);
    res.status(500).json({ message: 'Failed to load grouped inventory' });
  }
});

// Reorder / velocity view — joins on-hand quantity (InventoryItem) against
// the most recent sold-quantity period per product+location
// (InventorySalesRecord) to estimate days of supply left. Products with no
// matching sales record (name didn't match, or no sales export imported yet)
// are still returned with velocity/daysOfSupply as null rather than dropped,
// since "we don't know" is a different, more honest state than "infinite".
app.get('/api/inventory-analysis/velocity', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
  try {
    const { location = '' } = req.query;

    const stockMatch = location ? { location } : {};
    const onHand = await InventoryItem.aggregate([
      { $match: stockMatch },
      { $group: {
          _id: { product: '$product', location: '$location' },
          availableQuantity: { $sum: '$availableQuantity' },
          assetValue: { $sum: '$assetValue' },
          units: { $first: '$units' },
          category: { $first: '$category' }
      } }
    ]);

    const salesMatch = location ? { location } : {};
    const latestPerKey = await InventorySalesRecord.aggregate([
      { $match: salesMatch },
      { $sort: { periodEnd: -1 } },
      { $group: {
          _id: { product: '$product', location: '$location' },
          quantitySold: { $first: '$quantitySold' },
          periodStart: { $first: '$periodStart' },
          periodEnd: { $first: '$periodEnd' }
      } }
    ]);
    const salesByKey = new Map(latestPerKey.map(s => [`${s._id.product}::${s._id.location}`, s]));
    const canViewPrices = req.user.permissions.includes('view_inventory_prices');

    const rows = onHand.map(item => {
      const key = `${item._id.product}::${item._id.location}`;
      const sale = salesByKey.get(key);
      let velocityPerDay = null;
      let daysOfSupply = null;
      if (sale) {
        const periodDays = Math.max(1, (new Date(sale.periodEnd) - new Date(sale.periodStart)) / (1000 * 60 * 60 * 24));
        velocityPerDay = sale.quantitySold / periodDays;
        daysOfSupply = velocityPerDay > 0 ? item.availableQuantity / velocityPerDay : null;
      }
      return {
        product: item._id.product,
        location: item._id.location,
        category: item.category,
        units: item.units,
        availableQuantity: item.availableQuantity,
        assetValue: canViewPrices ? item.assetValue : null,
        quantitySoldInPeriod: sale?.quantitySold ?? null,
        periodStart: sale?.periodStart ?? null,
        periodEnd: sale?.periodEnd ?? null,
        velocityPerDay,
        daysOfSupply
      };
    });

    rows.sort((a, b) => {
      if (a.daysOfSupply === null) return 1;
      if (b.daysOfSupply === null) return -1;
      return a.daysOfSupply - b.daysOfSupply;
    });

    res.json({ rows });
  } catch (error) {
    console.error('Inventory analysis velocity error:', error);
    res.status(500).json({ message: 'Failed to load velocity analysis' });
  }
});

app.post('/api/inventory-analysis/import/stock/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    // Parsed in a worker thread, not on this request's own thread — see
    // runWorkbookParse.js for why an uploaded file needs that isolation.
    const { headers, mapping, missingRequired, rows } = await runWorkbookParse('inventory-stock', req.file.buffer);
    res.json({ success: true, headers, mapping, missingRequired, totalRows: rows.length, sample: rows.slice(0, 10) });
  } catch (error) {
    console.error('Inventory stock import preview error:', error);
    res.status(400).json({ message: `Preview failed: ${error.message}` });
  }
});

app.post('/api/inventory-analysis/import/stock/apply', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const { missingRequired, rows } = await runWorkbookParse('inventory-stock', req.file.buffer);
    if (missingRequired.length) {
      return res.status(400).json({ message: `Missing required column(s): ${missingRequired.join(', ')}` });
    }
    if (!rows.length) {
      return res.status(400).json({ message: 'No data rows found in file' });
    }

    const importedAt = new Date();
    const importedByName = req.user?.displayName || req.user?.contactName || req.user?.username || '';
    const importedById = req.user?.id || null;
    const docs = rows.map(r => ({ ...r, importedAt, importedByName, importedById }));

    // Insert the new snapshot BEFORE removing the old one. This used to
    // delete everything first — if insertMany then threw partway through
    // (a bad row, a dropped connection), the whole InventoryItems collection
    // was left empty with no way back, the same class of data-loss incident
    // as the Daily Work Report bug documented in CLAUDE.md. `importedAt` is
    // identical for every row in this batch, so it doubles as a batch tag:
    // on failure, only this batch's (possibly partial) rows are removed and
    // the previous snapshot is untouched.
    try {
      await InventoryItem.insertMany(docs, { ordered: false });
    } catch (insertErr) {
      await InventoryItem.deleteMany({ importedAt }).catch(() => {});
      throw insertErr;
    }
    await InventoryItem.deleteMany({ importedAt: { $ne: importedAt } });

    req.app.get('io')?.emit('inventory_analysis_update');
    res.json({ success: true, count: docs.length, importedAt });
  } catch (error) {
    console.error('Inventory stock import apply error:', error);
    res.status(400).json({ message: `Import failed: ${error.message}` });
  }
});

app.post('/api/inventory-analysis/import/sales/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const { headers, mapping, missingRequired, rows, detected } = await runWorkbookParse('inventory-sales', req.file.buffer);
    res.json({ success: true, headers, mapping, missingRequired, totalRows: rows.length, sample: rows.slice(0, 10), detected });
  } catch (error) {
    console.error('Inventory sales import preview error:', error);
    res.status(400).json({ message: `Preview failed: ${error.message}` });
  }
});

app.post('/api/inventory-analysis/import/sales/apply', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const { missingRequired, rows } = await runWorkbookParse('inventory-sales', req.file.buffer);
    if (missingRequired.length) {
      return res.status(400).json({ message: `Missing required column(s): ${missingRequired.join(', ')}` });
    }
    if (!rows.length) {
      return res.status(400).json({ message: 'No data rows found in file' });
    }

    const location = String(req.body.location || '').trim();
    const periodStart = req.body.periodStart ? new Date(req.body.periodStart) : null;
    const periodEnd = req.body.periodEnd ? new Date(req.body.periodEnd) : null;
    if (!location) return res.status(400).json({ message: 'Location is required' });
    if (!periodStart || !periodEnd || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      return res.status(400).json({ message: 'A valid period start and end date are required' });
    }
    // A reversed range doesn't fail loudly downstream — the velocity endpoint
    // floors (periodEnd - periodStart) at 1 day, so a swapped start/end would
    // silently read the whole period's total as "sold in one day" and make
    // every product's days-of-supply look ~N times too low.
    if (periodStart >= periodEnd) {
      return res.status(400).json({ message: 'Period start must be before period end' });
    }

    const importedAt = new Date();
    const importedByName = req.user?.displayName || req.user?.contactName || req.user?.username || '';
    const importedById = req.user?.id || null;

    // Re-importing the same period+location is a correction, not a
    // duplicate — replace just that slice rather than every period on file.
    // The unique (product, location, periodStart, periodEnd) index means the
    // new rows can't be inserted ahead of the old ones the way the stock
    // import does it, so this keeps an in-memory backup of the slice being
    // replaced and restores it if insertMany throws partway — a failed
    // re-import falls back to the last-known-good data instead of leaving
    // that period+location empty.
    const previousDocs = await InventorySalesRecord.find({ location, periodStart, periodEnd }).lean();
    await InventorySalesRecord.deleteMany({ location, periodStart, periodEnd });
    try {
      await InventorySalesRecord.insertMany(
        rows.map(r => ({ ...r, location, periodStart, periodEnd, importedAt, importedByName, importedById })),
        { ordered: false }
      );
    } catch (insertErr) {
      await InventorySalesRecord.deleteMany({ location, periodStart, periodEnd }).catch(() => {});
      if (previousDocs.length) {
        const restoreDocs = previousDocs.map(({ _id, __v, ...rest }) => rest);
        await InventorySalesRecord.insertMany(restoreDocs, { ordered: false }).catch(() => {});
      }
      throw insertErr;
    }

    req.app.get('io')?.emit('inventory_analysis_update');
    res.json({ success: true, count: rows.length, location, periodStart, periodEnd });
  } catch (error) {
    console.error('Inventory sales import apply error:', error);
    res.status(400).json({ message: `Import failed: ${error.message}` });
  }
});

// ============================================
// ADMIN LAZY LOADING ENDPOINTS
// ============================================

// Admin: Get lightweight product list (names only)
app.get('/api/admin/products/list', verifyToken, async (req, res) => {
  try {
    const products = await Product.find()
      .select('id name category collection availability image') // Include image for sidebar thumbnails
      .lean()
      .sort({ id: -1 });
    res.json(products);
  } catch (error) {
    console.error('Error fetching product list:', error);
    res.status(500).json({ message: 'Failed to fetch product list' });
  }
});

// Admin: Get full product details by ID
app.get('/api/admin/products/:id', verifyToken, async (req, res) => {
  try {
    const product = await Product.findOne({ id: parseInt(req.params.id) });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error fetching product details:', error);
    res.status(500).json({ message: 'Failed to fetch product details' });
  }
});

// Account & Security: reset a customer's password. The only surviving caller
// is the Sales CRM's info panel (manage_customer_accounts) — this route uses
// customer.save() rather than findByIdAndUpdate so the schema's pre('save')
// bcrypt hook actually runs; PUT /api/partners/:id (used for every other
// customer field) uses findByIdAndUpdate and would store a plaintext password.
app.put('/api/admin/customers/:id', verifyToken, requirePermission('manage_customer_accounts'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || !password.trim()) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    customer.password = password;
    await customer.save();
    req.app.get('io').emit('customer_update');

    res.json({
      success: true,
      message: 'Password updated successfully',
      customer: { id: customer._id, contactName: customer.contactName, email: customer.email }
    });
  } catch (error) {
    console.error('Reset customer password error:', error);
    res.status(500).json({ message: `Failed to reset password: ${error.message}` });
  }
});

// Update customer quick note
app.patch('/api/customers/:id/quick-note', verifyAnyAuth, async (req, res) => {
  try {
    const { quickNote } = req.body;

    // Authorization check: Only staff (admin/internal) can modify notes
    if (req.authType !== 'admin' && req.accountType !== 'internal') {
      return res.status(403).json({ message: 'Only staff can update quick notes' });
    }

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { quickNote },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ success: true, message: 'Quick note updated successfully', quickNote: customer.quickNote });
  } catch (error) {
    console.error('Update quick note error:', error);
    res.status(500).json({ message: 'Failed to update quick note' });
  }
});

// ── LOST SALES API ROUTES ──

// GET /api/lost-sales: Fetch all lost sales
app.get('/api/lost-sales', verifyAnyAuth, async (req, res) => {
  try {
    const list = await LostSale.find().sort({ date: -1, createdAt: -1 }).lean();
    res.json(list);
  } catch (error) {
    console.error('Error fetching lost sales:', error);
    res.status(500).json({ message: 'Failed to fetch lost sales' });
  }
});

// POST /api/lost-sales: Create a lost sale entry
app.post('/api/lost-sales', verifyAnyAuth, async (req, res) => {
  try {
    const data = req.body;
    const slabsCount = Number(data.slabsCount) || 1;
    const sfPerSlab = Number(data.sfPerSlab) || 0;
    const pricePerSf = Number(data.pricePerSf) || 0;
    const totalSf = data.totalSf ? Number(data.totalSf) : (slabsCount * sfPerSlab);
    const totalLostValue = data.totalLostValue ? Number(data.totalLostValue) : (totalSf * pricePerSf);

    const lostSale = new LostSale({
      customerName: data.customerName,
      customerId: data.customerId || null,
      productName: data.productName,
      productId: data.productId || null,
      lengthInches: Number(data.lengthInches) || 0,
      widthInches: Number(data.widthInches) || 0,
      sfPerSlab: sfPerSlab,
      slabsCount: slabsCount,
      totalSf: totalSf,
      pricePerSf: pricePerSf,
      totalLostValue: totalLostValue,
      reason: data.reason || 'Out of Stock',
      location: data.location || 'Seattle',
      competitorName: data.competitorName || '',
      notes: data.notes || '',
      salesRepName: data.salesRepName || req.user?.displayName || req.user?.contactName || 'Sales Rep',
      // authenticate() exposes the user's id as `id`, not `_id` — this read used
      // to always be undefined, so every lost sale was stored with a null rep id.
      salesRepId: data.salesRepId || req.user?.id || null,
      date: data.date ? new Date(data.date) : new Date()
    });

    await lostSale.save();
    req.app.get('io').emit('lost_sale_update');
    res.status(201).json(lostSale);
  } catch (error) {
    console.error('Error creating lost sale:', error);
    res.status(500).json({ message: 'Failed to create lost sale record', error: error.message });
  }
});

// PUT /api/lost-sales/:id: Update a lost sale entry
app.put('/api/lost-sales/:id', verifyAnyAuth, async (req, res) => {
  try {
    const data = req.body;
    const slabsCount = Number(data.slabsCount) || 1;
    const sfPerSlab = Number(data.sfPerSlab) || 0;
    const pricePerSf = Number(data.pricePerSf) || 0;
    const totalSf = data.totalSf ? Number(data.totalSf) : (slabsCount * sfPerSlab);
    const totalLostValue = data.totalLostValue ? Number(data.totalLostValue) : (totalSf * pricePerSf);

    const updateObj = {
      customerName: data.customerName,
      productName: data.productName,
      lengthInches: Number(data.lengthInches) || 0,
      widthInches: Number(data.widthInches) || 0,
      sfPerSlab: sfPerSlab,
      slabsCount: slabsCount,
      totalSf: totalSf,
      pricePerSf: pricePerSf,
      totalLostValue: totalLostValue,
      reason: data.reason,
      location: data.location,
      competitorName: data.competitorName || '',
      notes: data.notes || ''
    };
    if (data.salesRepName) updateObj.salesRepName = data.salesRepName;
    if (data.date) updateObj.date = new Date(data.date);

    // findByIdAndUpdate skips validators by default, so an edit could store a
    // `reason` outside the schema enum that POST would have rejected.
    const updated = await LostSale.findByIdAndUpdate(
      req.params.id,
      updateObj,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: 'Lost sale record not found' });
    }

    req.app.get('io').emit('lost_sale_update');
    res.json(updated);
  } catch (error) {
    console.error('Error updating lost sale:', error);
    res.status(500).json({ message: 'Failed to update lost sale record', error: error.message });
  }
});

// DELETE /api/lost-sales/:id: Delete a lost sale entry
app.delete('/api/lost-sales/:id', verifyAnyAuth, async (req, res) => {
  try {
    const deleted = await LostSale.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Lost sale record not found' });
    }
    req.app.get('io').emit('lost_sale_update');
    res.json({ success: true, message: 'Lost sale record deleted successfully' });
  } catch (error) {
    console.error('Error deleting lost sale:', error);
    res.status(500).json({ message: 'Failed to delete lost sale record' });
  }
});

// ── CROSSOVER SHEET API ROUTES ──
// Maps a distributor's color name to its Easy Stones equivalent, and how
// close the match is, so staff can quote a swap when a customer's usual
// distributor color isn't available.

// GET /api/crossover-sheet: Fetch all crossover entries
app.get('/api/crossover-sheet', authenticate, requirePermission('view_crossover_sheet'), async (req, res) => {
  try {
    const list = await CrossoverSheet.find().sort({ easyStonesName: 1 }).lean();
    res.json(list);
  } catch (error) {
    console.error('Error fetching crossover sheet:', error);
    res.status(500).json({ message: 'Failed to fetch crossover sheet' });
  }
});

// Resolves a typed Easy Stones name to its canonical stored casing —
// preferring whatever casing is already on an existing CrossoverSheet
// document (what's already on the matrix), then the color catalog's
// casing, then the typed casing as a last resort for a genuinely new/
// custom name. Without this, "enigma" vs "Enigma" would silently fork
// into two documents for the same real color — the exact failure mode
// that motivated moving this list into the database in the first place.
async function resolveCanonicalEasyStonesName(rawName, session) {
  const regex = { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' };
  let existingQuery = CrossoverSheet.findOne({ easyStonesName: regex }, { easyStonesName: 1 });
  if (session) existingQuery = existingQuery.session(session);
  const [existingDoc, catalogColor] = await Promise.all([
    existingQuery.lean(),
    EasyStonesColor.findOne({ name: regex }, { name: 1 }).lean()
  ]);
  return existingDoc?.easyStonesName || catalogColor?.name || rawName;
}

// True if one of `crossovers` already maps the same distributor + distributor
// color name (case-insensitive), so the same real mapping can't be added
// twice as duplicate chips in one matrix cell. `excludeId` skips the
// subdocument being edited in place, so saving it unchanged isn't flagged
// as a duplicate of itself.
function hasDuplicateMapping(crossovers, distributorName, distributorColorName, excludeId) {
  const dName = distributorName.toLowerCase();
  const dColor = distributorColorName.toLowerCase();
  return (crossovers || []).some(c =>
    (!excludeId || String(c._id) !== String(excludeId)) &&
    c.distributorName.toLowerCase() === dName &&
    c.distributorColorName.toLowerCase() === dColor
  );
}

// POST /api/crossover-sheet: Add a distributor mapping to a color's document,
// creating that color's document if this is its first mapping. Upsert+$push
// is one atomic operation, so two requests simultaneously adding the first
// mapping for the same color can't create duplicate color documents. (The
// duplicate-mapping check just above this is a separate, non-atomic
// check-then-act — an acceptable gap at this app's scale, since it only
// matters if two people add the exact same mapping within milliseconds of
// each other.)
app.post('/api/crossover-sheet', authenticate, requirePermission('add_crossover_sheet'), async (req, res) => {
  try {
    const rawName = (req.body.easyStonesName || '').trim();
    const distributorName = (req.body.distributorName || '').trim();
    const distributorColorName = (req.body.distributorColorName || '').trim();
    if (!rawName) {
      return res.status(400).json({ message: 'Easy Stones crossover name is required' });
    }

    const easyStonesName = await resolveCanonicalEasyStonesName(rawName);

    const existingDoc = await CrossoverSheet.findOne({ easyStonesName }, { crossovers: 1 }).lean();
    if (hasDuplicateMapping(existingDoc?.crossovers, distributorName, distributorColorName)) {
      return res.status(409).json({ message: 'This distributor mapping already exists for this color' });
    }

    const crossoverEntry = {
      distributorName,
      distributorColorName,
      matchType: req.body.matchType || 'Similar',
      notes: req.body.notes || '',
      addedByName: req.user?.displayName || req.user?.contactName || 'Sales Rep',
      addedById: req.user?.id || null
    };

    const colorDoc = await CrossoverSheet.findOneAndUpdate(
      { easyStonesName },
      { $push: { crossovers: crossoverEntry } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    req.app.get('io')?.emit('crossover_sheet_update');
    res.status(201).json(colorDoc);
  } catch (error) {
    console.error('Error creating crossover entry:', error);
    res.status(500).json({ message: 'Failed to create crossover entry', error: error.message });
  }
});

// PUT /api/crossover-sheet/:colorId/:crossoverId: Update one distributor
// mapping. If the edit changes which Easy Stones color it belongs to, the
// subdocument has to move from one color's document to another's (creating
// the destination document if it doesn't exist yet, and deleting the source
// document if that was its last mapping) — done in a transaction so a
// failure partway through can't delete the mapping from one document
// without it landing in the other.
app.put('/api/crossover-sheet/:colorId/:crossoverId', authenticate, requirePermission('edit_crossover_sheet'), async (req, res) => {
  const { colorId, crossoverId } = req.params;
  const rawNewName = (req.body.easyStonesName || '').trim();
  const fields = {
    distributorName: (req.body.distributorName || '').trim(),
    distributorColorName: (req.body.distributorColorName || '').trim(),
    matchType: req.body.matchType,
    notes: req.body.notes || ''
  };

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const colorDoc = await CrossoverSheet.findById(colorId).session(session);
    const entry = colorDoc?.crossovers.id(crossoverId);
    if (!colorDoc || !entry) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Crossover entry not found' });
    }

    const newEasyStonesName = rawNewName
      ? await resolveCanonicalEasyStonesName(rawNewName, session)
      : colorDoc.easyStonesName;
    const moved = newEasyStonesName !== colorDoc.easyStonesName;

    let colorDocResult;
    if (moved) {
      const destDoc = await CrossoverSheet.findOne({ easyStonesName: newEasyStonesName }).session(session);
      if (hasDuplicateMapping(destDoc?.crossovers, fields.distributorName, fields.distributorColorName)) {
        await session.abortTransaction();
        return res.status(409).json({ message: 'This distributor mapping already exists for the destination color' });
      }

      const movedEntry = { ...entry.toObject(), ...fields };
      entry.deleteOne();
      if (colorDoc.crossovers.length === 0) {
        await CrossoverSheet.findByIdAndDelete(colorId, { session });
      } else {
        await colorDoc.save({ session });
      }

      colorDocResult = await CrossoverSheet.findOneAndUpdate(
        { easyStonesName: newEasyStonesName },
        { $push: { crossovers: movedEntry } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
      );
    } else {
      if (hasDuplicateMapping(colorDoc.crossovers, fields.distributorName, fields.distributorColorName, crossoverId)) {
        await session.abortTransaction();
        return res.status(409).json({ message: 'This distributor mapping already exists for this color' });
      }
      Object.assign(entry, fields);
      await colorDoc.save({ session });
      colorDocResult = colorDoc;
    }

    await session.commitTransaction();
    req.app.get('io')?.emit('crossover_sheet_update');
    // `moved`/`sourceColorId` let the frontend patch its cached color docs
    // locally (drop the entry from the old color's doc, upsert the new one)
    // instead of refetching the whole crossover sheet after every edit.
    res.json({ moved, sourceColorId: colorId, colorDoc: colorDocResult });
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    console.error('Error updating crossover entry:', error);
    res.status(500).json({ message: 'Failed to update crossover entry', error: error.message });
  } finally {
    session.endSession();
  }
});

// DELETE /api/crossover-sheet/:colorId/:crossoverId: Remove one distributor
// mapping. Deletes the color's document too if that was its last mapping —
// an empty color document isn't needed for the matrix's empty-row seeding,
// that comes from the separate EasyStonesColor catalog now.
app.delete('/api/crossover-sheet/:colorId/:crossoverId', authenticate, requirePermission('delete_crossover_sheet'), async (req, res) => {
  try {
    const { colorId, crossoverId } = req.params;
    const colorDoc = await CrossoverSheet.findById(colorId);
    const entry = colorDoc?.crossovers.id(crossoverId);
    if (!colorDoc || !entry) {
      return res.status(404).json({ message: 'Crossover entry not found' });
    }

    entry.deleteOne();
    if (colorDoc.crossovers.length === 0) {
      await CrossoverSheet.findByIdAndDelete(colorId);
    } else {
      await colorDoc.save();
    }

    req.app.get('io')?.emit('crossover_sheet_update');
    res.json({ success: true, message: 'Crossover entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting crossover entry:', error);
    res.status(500).json({ message: 'Failed to delete crossover entry' });
  }
});

// GET /api/easy-stones-colors: List the Easy Stones color catalog used to
// seed the Crossover Sheet matrix. Same audience as the sheet itself.
app.get('/api/easy-stones-colors', authenticate, requirePermission('view_crossover_sheet'), async (req, res) => {
  try {
    const colors = await EasyStonesColor.find().sort({ order: 1 }).lean();
    res.json(colors);
  } catch (error) {
    console.error('Error fetching Easy Stones colors:', error);
    res.status(500).json({ message: 'Failed to fetch Easy Stones colors' });
  }
});

// POST /api/easy-stones-colors: Add a color to the catalog. Gated by a
// dedicated permission (not a hardcoded admin/director role check) since
// this list is shared across every rep's Crossover Sheet, not a per-entry
// edit — see the 'manage_easy_stones_colors' grant in the role seed above.
app.post('/api/easy-stones-colors', authenticate, requirePermission('manage_easy_stones_colors'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Color name is required' });
    }

    const existing = await EasyStonesColor.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    if (existing) {
      return res.status(409).json({ message: 'That color is already in the catalog' });
    }

    const highest = await EasyStonesColor.findOne().sort({ order: -1 }).lean();
    const color = await EasyStonesColor.create({ name, order: (highest?.order ?? -1) + 1 });
    req.app.get('io')?.emit('easy_stones_colors_update');
    res.status(201).json(color);
  } catch (error) {
    console.error('Error adding Easy Stones color:', error);
    res.status(500).json({ message: 'Failed to add color', error: error.message });
  }
});

// PUT /api/easy-stones-colors/:id: Rename a catalog color. Renaming does not
// touch existing Crossover Sheet entries pointing at the old name — see the
// note on the frontend's manage-colors modal before assuming otherwise.
app.put('/api/easy-stones-colors/:id', authenticate, requirePermission('manage_easy_stones_colors'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Color name is required' });
    }

    const updated = await EasyStonesColor.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(404).json({ message: 'Color not found' });
    }
    req.app.get('io')?.emit('easy_stones_colors_update');
    res.json(updated);
  } catch (error) {
    console.error('Error renaming Easy Stones color:', error);
    res.status(500).json({ message: 'Failed to rename color', error: error.message });
  }
});

// DELETE /api/easy-stones-colors/:id: Remove a color from the catalog. This
// only stops it being auto-seeded as an empty matrix row — any Crossover
// Sheet entries already pointing at its name are left as-is (they'll sort to
// the bottom as "not in the catalog," same as a misspelled name today).
app.delete('/api/easy-stones-colors/:id', authenticate, requirePermission('manage_easy_stones_colors'), async (req, res) => {
  try {
    const deleted = await EasyStonesColor.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Color not found' });
    }
    req.app.get('io')?.emit('easy_stones_colors_update');
    res.json({ success: true, message: 'Color deleted successfully' });
  } catch (error) {
    console.error('Error deleting Easy Stones color:', error);
    res.status(500).json({ message: 'Failed to delete color' });
  }
});

// Admin: Update customer status
app.patch('/api/admin/customers/:id/status', verifyToken, requirePermission('manage_customer_accounts'), async (req, res) => {
  try {
    const { isActive } = req.body;
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ success: true, message: `Customer ${isActive ? 'activated' : 'deactivated'} successfully` });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: 'Failed to update customer status' });
  }
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer for memory storage (direct upload to Cloudinary)
// Use memory storage to process file with Sharp before uploading
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload buffer to Cloudinary
const uploadToCloudinary = async (buffer, folder, filename) => {
  // Optimize before uploading to save credits
  const optimizedBuffer = await optimizeImage(buffer);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: filename,
        resource_type: 'auto'
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(optimizedBuffer);
  });
};

// Helper to process an array of images (base64 or URLs) and upload new base64 to Cloudinary
const processBase64Images = async (imagesArray, folder) => {
  if (!imagesArray || !Array.isArray(imagesArray)) return [];

  const processedImages = await Promise.all(imagesArray.map(async (img, index) => {
    // If it's already a URL, leave it as is
    if (!img || img.startsWith('http') || img.startsWith('/uploads/')) {
      return img;
    }

    // If it's base64, upload it
    if (img.startsWith('data:')) {
      try {
        const base64Data = img.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const result = await uploadToCloudinary(buffer, folder, `client_res_${uniqueSuffix}_${index}`);
        return result.secure_url;
      } catch (err) {
        console.error('Failed to upload base64 image to Cloudinary:', err);
        return img; // Fallback to base64 if upload fails
      }
    }

    // Default fallback
    return img;
  }));

  return processedImages;
};

// API endpoint to upload image
// verifyToken runs before the multer middleware on purpose — an unauthenticated
// request never gets this far into parsing/buffering a file at all, not just
// rejected after the work is already done. Was reachable with no auth
// whatsoever, letting anyone push files to this app's Cloudinary account.
app.post('/api/upload', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('✅ File received in memory:', req.file.originalname, `(${req.file.size} bytes)`);

    // Generate unique ID
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(req.file.originalname);
    const basename = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${basename}_${uniqueSuffix}`;

    // 1. Upload Main Image
    console.log('☁️ Uploading main image to Cloudinary...');
    const mainImageResult = await uploadToCloudinary(
      req.file.buffer,
      'products/main',
      filename
    );
    console.log('✅ Main image uploaded:', mainImageResult.secure_url);

    // 2. Generate and Upload Mockups
    // We pass the buffer directly to generateMockups
    console.log('🎨 Generating and uploading mockups...');
    let installedImages = [];
    try {
      installedImages = await generateMockups(req.file.buffer, filename);
    } catch (mockupError) {
      console.error('⚠️ Mockup generation failed (non-fatal):', mockupError);
      // Continue without mockups
    }

    res.json({
      success: true,
      filePath: mainImageResult.secure_url,
      installedImages: installedImages
    });

    // Bust cache so next GET /api/products sees the new image
    bustProductCache();
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file', details: error.message });
  }
});

// API endpoint to delete image from Cloudinary
// Was reachable with no auth at all — anyone who knew or guessed a Cloudinary
// URL on this account could delete it, no ownership check, nothing.
app.post('/api/upload/delete', verifyToken, async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'No image URL provided' });
    }

    // Only delete if it's a Cloudinary URL
    if (!imageUrl.includes('cloudinary.com')) {
      return res.status(400).json({ error: 'Not a Cloudinary URL' });
    }

    // Extract public_id from URL
    // Example URL: https://res.cloudinary.com/dqf4k0dn2/image/upload/v1768437320/products/filename.jpg
    // We need: products/filename (without extension)
    const urlParts = imageUrl.split('/');
    const uploadIndex = urlParts.indexOf('upload');

    if (uploadIndex === -1) {
      return res.status(400).json({ error: 'Invalid Cloudinary URL format' });
    }

    // Get everything after 'upload/vXXXXXXXXXX/'
    const pathAfterVersion = urlParts.slice(uploadIndex + 2).join('/');
    // Remove file extension
    const publicId = pathAfterVersion.replace(/\.[^/.]+$/, '');

    console.log('🗑️ Deleting from Cloudinary:', publicId);

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === 'ok' || result.result === 'not found') {
      console.log('✅ Image deleted successfully:', publicId);
      res.json({ success: true, message: 'Image deleted from Cloudinary' });
    } else {
      console.warn('⚠️ Cloudinary delete returned:', result);
      res.status(500).json({ error: 'Failed to delete image', details: result });
    }
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image', details: error.message });
  }
});


// Checl Cloudinary Config on Startup
if (process.env.CLOUDINARY_CLOUD_NAME) {
  console.log('☁️ Cloudinary configured with Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME);
} else {
  console.warn('⚠️ Cloudinary environment variables missing!');
}

// API endpoint to save products (Sync entire list or update/create individual)
// For simplicity and backward compatibility with the frontend logic, we'll accept the full list 
// but smarter logic would be to upsert individual items. 
// However, the frontend sends the *entire* list. 
// To keep it efficient, we can loop through and upsert.
// Was reachable with no auth at all: a single unauthenticated POST could
// upsert the entire live product catalog — every price, every description —
// since this does a bulk upsert on whatever array the request body sends.
app.post('/api/products/save', verifyToken, async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'Invalid products data' });
    }

    // Bulk write operations
    // Bulk write operations
    const operations = products.map(product => {
      // Remove _id and __v to prevent "immutable field" errors during update
      const { _id, __v, ...productData } = product;

      // Map 'collection' to 'collectionType' for the schema
      if (productData.collection) {
        productData.collectionType = productData.collection;
        delete productData.collection; // Remove the original to avoid conflicts
      }

      return {
        updateOne: {
          filter: { id: product.id },
          update: { $set: productData },
          upsert: true
        }
      };
    });

    if (operations.length > 0) {
      await Product.bulkWrite(operations);
    }

    // Optional: Delete products not in the list if you want strict sync
    // const ids = products.map(p => p.id);
    // await Product.deleteMany({ id: { $nin: ids } });

    res.json({ success: true, message: 'Products saved successfully' });
  } catch (error) {
    console.error('❌ Error saving products:', error);
    res.status(500).json({ error: 'Failed to save products', details: error.message });
  }
});

// One-time migration endpoint to populate collectionType from collection field
//
// Left live and reachable with no auth at all — a stray internal tool anyone
// on the internet could trigger, walking and rewriting every Product document.
// Gated to admin rather than any authenticated user, same bar as the other
// one-off/introspection routes in this file (see /api/sales-resources).
app.post('/api/migrate-collection', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const products = await Product.find({});
    let updated = 0;

    for (const product of products) {
      // If collectionType is missing but we have the data in the request or can infer it
      if (!product.collectionType && product.collection) {
        product.collectionType = product.collection;
        await product.save();
        updated++;
      }
    }

    console.log(`✅ Migration complete: Updated ${updated} products`);
    res.json({ success: true, message: `Updated ${updated} products with collectionType` });
    bustProductCache(); // Bust cache after migration
  } catch (error) {
    console.error('❌ Error during migration:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
  }
});

// ============================================
// SALES CRM API ENDPOINTS
// ============================================

// ============================================
// Create new sales customer (Maps to global Customer collection)
app.post('/api/sales/customers', verifyAnyAuth, async (req, res) => {
  try {
    const { customerName, company, address, phone, email, notes, status, level, customerType, modaDisplay, modaBinder, salesRep, location, coordinates, precision } = req.body;

    if (!company) {
      return res.status(400).json({ message: 'Company name is required' });
    }

    // Auto-generate dummy credentials if missing (Customer model requires them)
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);

    // Use provided email or generate a fake one
    const customerEmail = email && email.trim() !== ''
      ? email.trim().toLowerCase()
      : `sales_${timestamp}_${randomString}@temp-customer.com`;

    // Generate a random secure password
    const customerPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).toUpperCase().slice(-4) + "1!";

    // Optional point supplied by the caller — the route planner's "save this
    // Places search result as a lead" flow sends the coordinates Google
    // already returned, so this skips a redundant geocoding call (see
    // geocodePatchFor in src/utils/geocode.js, which stays the path for
    // every other create/edit route that only has an address to go on).
    // Validated here since it's client-supplied and, unlike the geocoder
    // response, never checked against a real address lookup.
    const lat = Number(coordinates?.lat);
    const lng = Number(coordinates?.lng);
    const hasValidPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const validPrecision = Object.values(GEOCODE_PRECISION).includes(precision) ? precision : GEOCODE_PRECISION.APPROXIMATE;

    const addressFields = {
      street: address?.street || '',
      city: address?.city || '',
      state: address?.state || '',
      zipCode: address?.zipCode || ''
    };

    const newCustomer = new Customer({
      contactName: customerName || company, // Fallback to company if no contact name
      email: customerEmail,
      password: customerPassword,
      company: company,
      phone: phone || '',
      address: addressFields,
      quickNote: notes || '',
      status: status || 'New',
      level: level || 'Level - 3',
      customerType: customerType || 'Fabricator',
      modaDisplay: modaDisplay || 'No',
      modaBinder: modaBinder || '0',
      ...(await resolveSalesRep(salesRep)),
      location: String(location || '').trim() || 'Seattle',
      isVerified: true, // Auto-verify sales-created accounts
      priceLevel: 1,
      isActive: true,
      ...(hasValidPoint && {
        coordinates: { lat, lng },
        geocode: {
          status: 'ok',
          precision: validPrecision,
          formattedAddress: '',
          addressKey: addressKeyOf(addressFields),
          updatedAt: new Date(),
          error: ''
        }
      })
    });

    await newCustomer.save();
    req.app.get('io').emit('customer_update');

    // Return formatted to match what the frontend expects
    res.status(201).json(newCustomer);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A customer with this email already exists.' });
    }
    console.error('Error creating sales customer:', error);
    res.status(500).json({ message: `Failed to create customer: ${error.message}` });
  }
});

// ===== SALES RESOURCES (GLOBAL/SHARED) ENDPOINTS =====

// Get all sales resources
// Get all sales resources
app.get('/api/sales-resources', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const resources = await SalesResource.find().sort({ createdAt: -1 });
    res.json(resources);
  } catch (error) {
    console.error('Error fetching sales resources:', error);
    res.status(500).json({ message: 'Failed to fetch resources' });
  }
});

// Create a new sales resource
// Create a new sales resource
app.post('/api/sales-resources', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { name, type, content, contentType } = req.body;

    const resource = new SalesResource({
      name,
      type,
      content,
      contentType,
      uploadedBy: req.userId
    });

    await resource.save();
    req.app.get('io').emit('resource_update');
    res.status(201).json(resource);
  } catch (error) {
    console.error('Error creating sales resource:', error);
    res.status(500).json({ message: 'Failed to create resource' });
  }
});

// Delete a sales resource
app.delete('/api/sales-resources/:id', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await SalesResource.findByIdAndDelete(id);
    req.app.get('io').emit('resource_update');
    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Error deleting sales resource:', error);
    res.status(500).json({ message: 'Failed to delete resource' });
  }
});


// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbStatusMap = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  let dbPing = 'failed';
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping();
      dbPing = 'success';
    }
  } catch (err) {
    dbPing = `error: ${err.message}`;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbStatus: dbStatusMap[mongoose.connection.readyState] || 'unknown',
    dbPing: dbPing,
    dbHost: mongoose.connection.host
  });
});

// An /api path that matched no route used to fall through to the SPA and answer
// with index.html, so the caller's res.json() failed on "Unexpected token '<'"
// — which says nothing about the actual problem (a typo, or a server running
// code older than the client). Answer as the API, not as the app.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `No such endpoint: ${req.method} ${req.originalUrl}`,
    hint: 'If this endpoint is new, the running server may predate it — restart it.'
  });
});

// Serve uploaded files with long-term caching
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
  maxAge: '1y',
  immutable: true
}));

// Serve other static assets with medium caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d'
}));

// Serve React production build
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  // Everything under /assets carries a content hash in its filename, so a year
  // of immutable caching is correct there. These four do NOT — their names stay
  // the same across every deploy, so caching them was pinning browsers to an old
  // build: sw.js in particular precaches index.html and every chunk, so a stale
  // copy keeps serving the previous app no matter what the server sends.
  const NEVER_CACHE = new Set(['/sw.js', '/registerSW.js', '/manifest.webmanifest', '/index.html']);

  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false, // Don't serve index.html with long cache
    setHeaders: (res, filePath) => {
      const name = '/' + path.basename(filePath);
      if (NEVER_CACHE.has(name)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  }));

  app.get(/(.*)/, (req, res) => {
    // Send index.html with NO CACHE so users always get the latest version of the app
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

