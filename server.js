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
// The one list of "every model that needs its indexes created on startup" —
// see its own comment for why this used to be two hand-maintained arrays
// (here and in ensure-indexes.js) that had already drifted apart.
import { INDEXED_MODELS } from './src/config/indexedModels.js';
import { parseLocationBody, publicLocationFields } from './src/utils/locationForm.js';
import { sendContactFormEmail } from './src/services/emailService.js';
import { scrapeErpCustomers, scrapeErpInventory, scrapeErpSales } from './src/services/erpImportService.js';
// Shared with the client so an import can only assign a customer to someone the
// Sales Rep dropdown would also have offered.
import { isSalesRep } from './src/utils/salesReps.js';
import { geocodeAddress, geocodePatchFor, addressKeyOf, GEOCODE_PRECISION } from './src/utils/geocode.js';
import { newCustomerFields, customerUpdateFields, addressFrom, suppliedPoint } from './src/utils/customerRecord.js';
// One definition of "these two records are the same business", shared by the
// import, the duplicate audit and the merge script.
import { groupDuplicates, STRONG, withoutSeparated, buildSignalIndex, matchAgainst } from './src/utils/customerMatch.js';
// The customer list's saved views, A–Z jump and "incomplete" rule, shared with
// the screen (PartnersSheet) so the ⚠ it shows and the view that finds those
// rows can't disagree.
import { savedViewQuery, isSavedView, letterQuery, STATUSES, SAVED_VIEWS } from './src/utils/customerList.js';
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
import createPinnedTabsRouter from './src/routes/pinnedTabs.js';
import createNavOrderRouter from './src/routes/navOrder.js';
import createGeocodeRouter from './src/routes/geocode.js';
import { startAutoSubmitDailyReports } from './src/jobs/autoSubmitDailyReports.js';
import { linkVisitToSchedule, unlinkVisitFromSchedule, moveVisitOnSchedule } from './src/services/visitSchedule.js';
import { normalizeVisitDate, normalizeOptionalDate } from './src/utils/visitDates.js';
import { canModifyVisit, canDeleteVisit, ANY_EDIT_VISIT_PERMISSIONS, ANY_DELETE_VISIT_PERMISSIONS } from './src/utils/visitAccess.js';
import { homeLocationOf, homeLocationProblem, fallbackHomeLocation } from './src/utils/locationFilter.js';
import {
  getAggregationRangeMatch, getFollowUpRangeMatch, rangePrefilter, followUpDatePrefilter, slimForUnwind,
  dashboardScope, scopeBranchPrefilter, scopeVisitUserMatch, narrowScopeToLocation
} from './src/utils/dashboardMatch.js';
import createScheduleRouter, { createScheduleEmitter } from './src/routes/schedule.js';
import createInventoryAnalysisRouter from './src/routes/inventoryAnalysis.js';
import createUserOnboardingRouter, { newInvite, inviteLinkFor, sendInviteEmail } from './src/routes/userOnboarding.js';
import { usernameProblem, isValidEmail, isValidDateInput, PASSWORD_MIN } from './src/utils/userForm.js';
import Delivery from './src/models/Delivery.js';
import { insertInBatches, withDbRetry, hasRowErrorsOnly } from './src/utils/dbRetry.js';
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
  const user = await User.findById(userId, 'assignedLocations isActive').lean();
  if (!user || user.isActive === false) return null;
  return user.assignedLocations || [];
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
  // Re-sent whenever the browser's session changes (sign-in, sign-out, a
  // different person on the same tab — src/api/deliverySchedule.js), so it
  // first leaves whatever delivery rooms the socket was in: a new user must
  // never keep the last one's branches. A missing or failed token leaves the
  // socket in none. `ack` (optional) tells the browser whether it worked, so a
  // refused join can fetch a fresh token or fall back to polling instead of
  // sitting "connected" and receiving nothing.
  socket.on('join_delivery_rooms', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    for (const room of socket.rooms) {
      if (room.startsWith('delivery-location:')) socket.leave(room);
    }
    try {
      const assignedLocations = await resolveSocketAssignedLocations(payload?.token);
      if (!assignedLocations) return reply({ ok: false });
      if (assignedLocations.includes('*')) {
        socket.join(DELIVERY_ROOM_ALL);
      } else {
        for (const location of assignedLocations) socket.join(deliveryRoomFor(location));
      }
      reply({ ok: true });
    } catch {
      // Invalid/expired token — leave the socket out of every delivery room
      // rather than erroring the whole connection.
      reply({ ok: false });
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

// Today as 'YYYY-MM-DD' in the business's own zone, whatever zone the server runs in.
const pacificToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

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
            'view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures',
            'add_visits', 'edit_own_visits', 'delete_own_visits',
            'view_all_visits', 'edit_all_visits', 'delete_all_visits'
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
            'view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures',
            'add_visits', 'edit_own_visits', 'delete_own_visits',
            'view_all_visits', 'edit_all_visits', 'delete_all_visits'
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
            'view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures',
            'add_visits', 'edit_own_visits', 'delete_own_visits',
            'view_branch_visits', 'edit_branch_visits', 'delete_branch_visits'
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
            'view_delivery_schedule', 'edit_delivery_schedule',
            'add_visits', 'edit_own_visits', 'delete_own_visits'
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
            'view_delivery_schedule', 'delivery_driver_view'
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
        { roles: ['admin', 'director'], permissions: ['manage_customer_accounts'] },
        // Who sees and changes other people's visits was hardcoded by role name
        // (admin/director: all, manager: their branches). Now it's four Users &
        // Roles toggles — see src/utils/visitAccess.js. Defaults preserve that.
        { roles: ['admin', 'director'], permissions: ['view_all_visits', 'edit_all_visits'] },
        { roles: ['manager'], permissions: ['view_branch_visits', 'edit_branch_visits'] },
        // Delete split out from edit, so a role can correct visits without
        // being able to remove them. Defaults match what edit allowed before.
        { roles: ['admin', 'director'], permissions: ['delete_all_visits'] },
        { roles: ['manager'], permissions: ['delete_branch_visits'] },
        // Which Delivery Schedule screen someone gets was decided by role name
        // (driver/logistics → driver screen, admin/manager → office board).
        // It's now permissions only (src/utils/deliveryAccess.js), with Driver
        // view as its own switch; this keeps today's drivers on their screen.
        { roles: ['driver', 'logistics'], permissions: ['delivery_driver_view'] }
      ];

      // Each grant reaches a role once. Its permissions are recorded in
      // role.seededPermissions, and a permission already recorded there is never
      // granted again — so one switched off under Users & Roles stays off.
      // (This used to re-grant anything missing on every boot, silently undoing
      // those changes at the next restart.) On the first boot with this, every
      // grant is checked once more, exactly as before, and recorded.
      const grantsByRole = new Map();
      for (const grant of NEW_PERMISSION_GRANTS) {
        for (const roleName of grant.roles) {
          grantsByRole.set(roleName, [...(grantsByRole.get(roleName) || []), ...grant.permissions]);
        }
      }
      for (const [roleName, granted] of grantsByRole) {
        const role = await Role.findOne({ name: roleName });
        if (!role) continue;
        const seeded = new Set(role.seededPermissions || []);
        const pending = [...new Set(granted)].filter(p => !seeded.has(p));
        if (pending.length === 0) continue;
        const missing = pending.filter(p => !role.permissions.includes(p));
        role.permissions.push(...missing);
        role.seededPermissions = [...seeded, ...pending];
        await role.save();
        if (missing.length) console.log(`🔑 Granted ${roleName}: ${missing.join(', ')}`);
      }

      // Adding, editing and deleting your own visits moved from Customers
      // (manage_customers / delete_customers) to their own Visits permissions.
      // Every role — custom ones too — gets whatever its Customers permissions
      // already allowed, once (recorded in seededPermissions like the grants
      // above), so nobody loses access on the day it ships and switching one off
      // afterwards sticks.
      const VISIT_ACTION_MIGRATION = [
        { from: 'manage_customers', grant: ['add_visits', 'edit_own_visits', 'delete_own_visits'] },
        { from: 'delete_customers', grant: ['delete_own_visits'] }
      ];
      const migratedPerms = [...new Set(VISIT_ACTION_MIGRATION.flatMap(m => m.grant))];
      for (const role of await Role.find({})) {
        const seeded = new Set(role.seededPermissions || []);
        const pending = migratedPerms.filter(p => !seeded.has(p));
        if (pending.length === 0) continue;
        const earned = new Set(VISIT_ACTION_MIGRATION.filter(m => role.permissions.includes(m.from)).flatMap(m => m.grant));
        const missing = pending.filter(p => earned.has(p) && !role.permissions.includes(p));
        role.permissions.push(...missing);
        role.seededPermissions = [...seeded, ...pending];
        await role.save();
        if (missing.length) console.log(`🔑 Granted ${role.name}: ${missing.join(', ')} (from its Customers permissions)`);
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

      // Driver accounts used to be re-created here on every start-up when
      // missing — username "driver" and "sergio" with passwords written in this
      // file. Anyone who read the source could sign in as them, and deleting
      // either account brought it straight back. Staff accounts are created in
      // Users & Roles, with their own passwords, like every other user.
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
    // Every customer write is under /api/customers since 2026-10-06; the other
    // three are its old addresses, still answered until cached apps update.
    // (/api/sales/customers missing from this list is why a new customer
    // didn't show in the dropdown for up to ten minutes.)
    if (url.startsWith('/api/customers') || url.startsWith('/api/sales/customers') || url.startsWith('/api/partners') || url.startsWith('/api/admin/customers')) {
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
          // For GET /api/user/me, which answers from this instead of a
          // second findById — one round trip fewer on every page load.
          location: 1,
          routePlannerFilters: 1,
          pinnedTabs: 1,
          isActive: 1,
          permissions: { $ifNull: [{ $arrayElemAt: ['$_role.permissions', 0] }, []] }
        }
      }
    ]);

    if (!dbUser) {
      return res.status(401).json({ error: 'User account not found or has been removed.' });
    }
    // Deactivated in Users & Roles: a session they already had open ends on
    // its next request, not only at the next sign-in. Missing = active (every
    // account created before the switch existed).
    if (dbUser.isActive === false) {
      return res.status(401).json({ error: 'This account has been deactivated. Contact an administrator.' });
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

    // The projected document itself (no password or calendar tokens — see the
    // $project above), for routes that need its raw fields; GET /api/user/me.
    req.authUserDoc = dbUser;

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

    // Checked after the password, so it can't be used to probe which
    // usernames exist. Missing = active.
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated. Contact an administrator.'
      });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // Created with a temporary password: no session until they choose their
    // own. The login page asks for one and calls /api/auth/first-password.
    if (user.mustChangePassword) {
      return res.json({
        success: false,
        code: 'must-change-password',
        message: 'Choose your own password to finish signing in.'
      });
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

// Settles a user's home location (User.location) against their assigned
// locations before a save — it's what every location filter opens on and what
// new records default to, so it has to be one of their own branches
// (src/utils/locationFilter.js). A home location someone actually chose that
// isn't theirs is refused; one that just stopped being valid (their assigned
// locations changed, or it's a leftover '*') falls back to their first branch,
// the same rule the Users & Roles form applies as you edit.
// `requested` is undefined when the request didn't send one, or sent back the
// value already stored — /admin's form returns every field on every save.
const resolveHomeLocation = async ({ requested, current, assignedLocations }) => {
  const assigned = Array.isArray(assignedLocations) ? assignedLocations : [];
  const loc = typeof requested === 'string' ? requested.trim() : undefined;
  if (loc !== undefined && loc !== (current || '')) {
    const known = assigned.includes('*') ? await Location.find().select('name').lean() : [];
    const problem = homeLocationProblem(loc, assigned, known);
    if (problem) return { error: problem };
    if (loc || assigned.includes('*')) return { location: loc };
  }
  return {
    location: homeLocationOf({ location: current, assignedLocations: assigned })
      || (assigned.includes('*') ? '' : fallbackHomeLocation(assigned))
  };
};

// Username check, first-sign-in password, emailed invites — see the module.
app.use('/api', createUserOnboardingRouter({ authenticate, requirePermission, loginLimiter }));

// Get all users (manage_users permission needed)
app.get('/api/admin/users', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// Create new user (manage_users permission needed) — Add User in Users &
// Roles (src/components/sales/users/AddUserForm.jsx). The form checks all of
// this first; it's repeated here because the server is what actually guards
// the data. Sign-in is either a temporary password (mustChangePassword: they
// pick their own at first sign-in) or an emailed invite link
// (src/routes/userOnboarding.js).
app.post('/api/admin/users', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const { displayName, email, role, location, assignedLocations, joiningDate, signInMethod = 'password', password } = req.body;
    const username = String(req.body.username || '').trim().toLowerCase();
    const fail = (field, message) => res.status(400).json({ field, message });

    if (!String(displayName || '').trim()) return fail('displayName', 'Enter their full name');
    if (!isValidEmail(email)) return fail('email', 'Enter a valid work email');
    const uProblem = usernameProblem(username);
    if (uProblem) return fail('username', uProblem);
    if (!isValidDateInput(joiningDate)) return fail('joiningDate', 'Pick the day they start');
    if (!Array.isArray(assignedLocations) || assignedLocations.length === 0 || !assignedLocations.every(l => typeof l === 'string' && l)) {
      return fail('assignedLocations', 'Choose at least one location');
    }
    if (!['password', 'invite'].includes(signInMethod)) return fail('signInMethod', 'Choose how they sign in');
    if (signInMethod === 'password' && String(password || '').length < PASSWORD_MIN) {
      return fail('password', `At least ${PASSWORD_MIN} characters`);
    }
    const roleName = String(role || '').trim().toLowerCase();
    if (!roleName || !(await Role.exists({ name: roleName }))) return fail('role', 'Pick a role');

    if (await User.exists({ username })) return fail('username', 'Someone already has this username');

    const home = await resolveHomeLocation({ requested: location, current: '', assignedLocations });
    if (home.error) return fail('assignedLocations', home.error);

    const invite = signInMethod === 'invite' ? newInvite() : null;
    const newUser = new User({
      username,
      displayName: String(displayName).trim(),
      password: invite ? invite.placeholderPassword : password,
      email: String(email).trim(),
      role: roleName,
      location: home.location,
      assignedLocations,
      joiningDate: new Date(`${joiningDate}T00:00:00Z`),
      mustChangePassword: !invite,
      ...(invite ? invite.fields : {}),
      editedBy: req.user?.username || '',
      editedAt: new Date()
    });

    try {
      await newUser.save();
    } catch (err) {
      // Two admins creating the same username at once — the unique index wins.
      if (err?.code === 11000) return fail('username', 'Someone already has this username');
      throw err;
    }

    bustUserCaches();
    // Driver lists on open delivery boards are built from these accounts and are
    // cached client-side, so tell them to refetch instead of showing a stale name.
    req.app.get('io')?.emit('truck_update');

    let inviteSent = null;
    let inviteLink;
    if (invite) {
      const link = inviteLinkFor(req, invite.token);
      inviteSent = await sendInviteEmail({
        to: newUser.email,
        name: displayNameOf(newUser),
        username: newUser.username,
        link,
        invitedBy: req.user?.displayName || req.user?.username
      });
      // Only when the email didn't go out: the admin can pass the link on
      // themselves. They can already set this account's password, so it gives
      // them nothing new.
      if (!inviteSent) inviteLink = link;
    }

    res.status(201).json({
      message: 'User created successfully',
      inviteSent,
      ...(inviteLink ? { inviteLink } : {}),
      user: {
        id: newUser._id,
        _id: newUser._id,
        username: newUser.username,
        displayName: newUser.displayName,
        name: displayNameOf(newUser),
        email: newUser.email,
        role: newUser.role,
        location: newUser.location,
        assignedLocations: newUser.assignedLocations,
        joiningDate: newUser.joiningDate,
        mustChangePassword: newUser.mustChangePassword,
        isActive: true
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user', error: error.message });
  }
});

// Update user (manage_users permission needed)
app.put('/api/admin/users/:id', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const { username, displayName, email, role, password, location, assignedLocations, joiningDate, signInReset } = req.body;
    const userId = req.params.id;
    // Fields are checked only when sent, so the older /admin screen's partial
    // saves still work; Edit user (users/EditUserForm.jsx) sends them all.
    const fail = (field, message) => res.status(400).json({ field, message });

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (displayName !== undefined && !String(displayName).trim()) return fail('displayName', 'Enter their full name');
    if (email !== undefined && !isValidEmail(email)) return fail('email', 'Enter a valid work email');
    if (joiningDate !== undefined && !isValidDateInput(joiningDate)) return fail('joiningDate', 'Pick the day they start');
    if (assignedLocations !== undefined && (!Array.isArray(assignedLocations) || assignedLocations.length === 0 || !assignedLocations.every(l => typeof l === 'string' && l))) {
      return fail('assignedLocations', 'Choose at least one location');
    }
    let nextRole;
    if (role !== undefined) {
      nextRole = String(role || '').trim().toLowerCase();
      if (!nextRole || !(await Role.exists({ name: nextRole }))) return fail('role', 'Pick a role');
    }
    if (signInReset !== undefined && !['password', 'invite'].includes(signInReset)) return fail('signInReset', 'Choose how they sign in');
    if (signInReset === 'password' && String(password || '').length < PASSWORD_MIN) return fail('password', `At least ${PASSWORD_MIN} characters`);
    if (signInReset === 'invite' && !isValidEmail(email !== undefined ? email : user.email)) return fail('email', 'Add a work email to send the link to');

    // A driver moved to a role without Driver view loses their truck column;
    // orders still on it would be stranded, exactly as when deactivating.
    if (nextRole && nextRole !== user.role) {
      const [fromRole, toRole] = await Promise.all([
        Role.findOne({ name: user.role }).select('permissions').lean(),
        Role.findOne({ name: nextRole }).select('permissions').lean()
      ]);
      const wasDriver = (fromRole?.permissions || []).includes('delivery_driver_view');
      const staysDriver = (toRole?.permissions || []).includes('delivery_driver_view');
      if (wasDriver && !staysDriver && !(await clearDriverHandover(req, res, user, 'change the role of'))) return;
    }

    // Read before anything is applied: displayNameOf() falls back to the
    // username, so a change to either field can change the name the rest of the
    // system shows for this person.
    const nameBefore = displayNameOf(user);

    // Check if new username is already taken by another user
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return fail('username', 'Someone already has this username');
      }
      user.username = username;
    }

    // Clearing the box is a real edit — '' means "go back to deriving it from
    // the username", so this is an !== undefined check, not a truthiness one.
    if (displayName !== undefined) user.displayName = String(displayName).trim();
    if (email !== undefined) user.email = String(email).trim();
    if (nextRole) user.role = nextRole;
    if (joiningDate !== undefined) user.joiningDate = new Date(`${joiningDate}T00:00:00Z`);
    if (location !== undefined || assignedLocations !== undefined) {
      const nextAssigned = assignedLocations !== undefined ? assignedLocations : (user.assignedLocations || []);
      const home = await resolveHomeLocation({ requested: location, current: user.location, assignedLocations: nextAssigned });
      if (home.error) return fail('assignedLocations', home.error);
      user.location = home.location;
      if (assignedLocations !== undefined) user.assignedLocations = assignedLocations;
    }

    // Resetting sign-in (Edit user → Sign-in):
    //   'password' — a temporary password they must replace at next sign-in;
    //   'invite'   — an emailed link to choose one (their current password
    //                keeps working until they use it).
    // A bare `password` (the older /admin screen) still just sets it.
    let invite = null;
    if (signInReset === 'password') {
      user.password = password; // hashed by the pre-save hook
      user.mustChangePassword = true;
      user.inviteTokenHash = null;
      user.inviteExpiresAt = null;
    } else if (signInReset === 'invite') {
      invite = newInvite();
      user.inviteTokenHash = invite.fields.inviteTokenHash;
      user.inviteExpiresAt = invite.fields.inviteExpiresAt;
    } else if (password) {
      user.password = password; // Will be hashed by pre-save hook
    }

    user.editedBy = req.user?.username || '';
    user.editedAt = new Date();
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
    bustUserCaches();
    req.app.get('io')?.emit('truck_update');

    let inviteSent = null;
    let inviteLink;
    if (invite) {
      const link = inviteLinkFor(req, invite.token);
      inviteSent = await sendInviteEmail({
        to: user.email,
        name: displayNameOf(user),
        username: user.username,
        link,
        invitedBy: req.user?.displayName || req.user?.username,
        reset: true
      });
      if (!inviteSent) inviteLink = link;
    }

    res.json({
      message: 'User updated successfully',
      inviteSent,
      ...(inviteLink ? { inviteLink } : {}),
      user: {
        id: user._id,
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        name: displayNameOf(user),
        email: user.email,
        role: user.role,
        location: user.location,
        assignedLocations: user.assignedLocations,
        joiningDate: user.joiningDate,
        mustChangePassword: user.mustChangePassword,
        editedBy: user.editedBy,
        editedAt: user.editedAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

// Delete user (manage_users permission needed)
// A driver's orders that haven't happened yet: on their truck column, not
// delivered or cancelled, dated today or later (or not dated). Taking the
// driver away — deactivating or deleting them — would otherwise leave these
// on a column nobody is driving.
const DRIVER_ORDER_PROJECTION = { 'pod.customerSignature': 0, 'pod.driverSignature': 0, 'pod.photos': 0 };
const upcomingDriverOrders = (user) => Delivery.find({
  truckId: `drv_${user.username}`,
  status: { $nin: ['completed', 'cancelled'] },
  $or: [{ date: { $gte: pacificToday() } }, { date: '' }, { date: null }]
}, '_id').lean();

/** Move orders to Pending (no driver, same date) and tell open boards, branch by branch. */
const moveOrdersToPending = async (req, orders) => {
  if (!orders.length) return;
  const ids = orders.map(o => o._id);
  await withDbRetry(() => Delivery.updateMany({ _id: { $in: ids } }, { $set: { truckId: '', status: 'pending' } }));
  const updated = await Delivery.find({ _id: { $in: ids } }, DRIVER_ORDER_PROJECTION).lean();
  const io = req.app.get('io');
  for (const delivery of updated) {
    const rooms = new Set([DELIVERY_ROOM_ALL]);
    if (delivery.location) rooms.add(deliveryRoomFor(delivery.location));
    if (delivery.deliveryType === 'transfer' && delivery.transferDestination) rooms.add(deliveryRoomFor(delivery.transferDestination));
    for (const room of rooms) io?.to(room).emit('delivery_update', { type: 'upsert', delivery });
  }
};

/**
 * Before a driver is taken away (deactivated or deleted): refuse while they
 * still have upcoming orders, unless the request says to move those to
 * Pending as part of it. Returns true once it's safe to go ahead; otherwise
 * it has already answered 409 with the count.
 */
const clearDriverHandover = async (req, res, user, verb) => {
  const upcoming = await upcomingDriverOrders(user);
  if (!upcoming.length) return true;
  if (!req.body?.moveUpcomingToPending) {
    res.status(409).json({
      code: 'has-upcoming-orders',
      upcoming: upcoming.length,
      message: `${displayNameOf(user)} still has ${upcoming.length} upcoming order${upcoming.length === 1 ? '' : 's'}. Move ${upcoming.length === 1 ? 'it' : 'them'} to another driver or to Pending before you ${verb} this account.`
    });
    return false;
  }
  await moveOrdersToPending(req, upcoming);
  return true;
};

// Deactivate or reactivate a staff account. Deactivated: can't sign in, any
// open session ends on its next request, their calendar feed stops, and a
// driver drops off the board's columns except on weeks they delivered. Kept,
// not deleted, so their name stays on the history they made.
app.patch('/api/admin/users/:id/active', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const active = req.body?.active !== false;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'User not found' });
    if (!active && String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: "You can't deactivate your own account." });
    }
    const user = await User.findById(req.params.id).select('username displayName isActive').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!active && !(await clearDriverHandover(req, res, user, 'deactivate'))) return;

    await User.updateOne({ _id: user._id }, active
      ? { $set: { isActive: true }, $unset: { deactivatedAt: 1, deactivatedBy: 1 } }
      : { $set: { isActive: false, deactivatedAt: new Date(), deactivatedBy: req.user?.username || '' } });
    bustUserCaches();
    req.app.get('io')?.emit('truck_update');
    res.json({ success: true, isActive: active });
  } catch (error) {
    console.error('User activation change error:', error);
    res.status(500).json({ message: 'Failed to change this account' });
  }
});

app.delete('/api/admin/users/:id', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: "You can't delete your own account." });
    }
    const user = mongoose.Types.ObjectId.isValid(req.params.id)
      ? await User.findById(req.params.id).select('username displayName').lean()
      : null;
    if (user && !(await clearDriverHandover(req, res, user, 'delete'))) return;
    await User.findByIdAndDelete(req.params.id);
    bustUserCaches();
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
    bustUserCaches(); // see the role update route below
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
    // A role's permissions decide who counts as a delivery driver in the
    // staff list (/api/salesreps), so it can't serve a stale copy.
    bustUserCaches();
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
    // A role's permissions decide who counts as a delivery driver in the
    // staff list (/api/salesreps), so it can't serve a stale copy.
    bustUserCaches();
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete role', error: error.message });
  }
});

// ============================================
// DYNAMIC LOCATION MANAGEMENT ENDPOINTS
// ============================================

// Get all locations (authenticated staff or kiosks can view)
// Locations — Users & Roles → Locations, and every location filter.
// The full record (accounting contact, sales defaults, cost overrides) is for
// people who can manage locations; this endpoint also answers customer and
// other staff logins, which get only what prints on a selection sheet and
// what the filters need (publicLocationFields).
app.get('/api/admin/locations', verifyAnyAuth, async (req, res) => {
  try {
    const locations = await Location.find().sort({ name: 1 }).lean();
    const full = req.user?.permissions?.includes('manage_users');
    res.json(full ? locations : locations.map(publicLocationFields));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch locations', error: error.message });
  }
});

// The map pin for a location's primary address — only looked up again when
// the address changed (geocodePatchFor), and never blocks the save.
const applyLocationGeocode = async (location) => {
  const a = location.primaryContact?.address || {};
  const patch = await geocodePatchFor(
    { street: a.street, city: a.city, state: a.state, zipCode: a.zipCode },
    location.geocode?.addressKey || ''
  );
  if (!patch) return;
  location.coordinates = patch.coordinates;
  location.geocode = patch.geocode;
};

// Add / Edit location (src/components/sales/locations/LocationForm.jsx). The
// body is the whole record; src/utils/locationForm.js runs the same checks
// the form does, and answers { field, message } for the first problem so the
// form can put it under the right field.
const locationError = (res, errors) => {
  const [field, message] = Object.entries(errors)[0];
  return res.status(400).json({ field, message, errors });
};

// Create a new location (manage_users permission needed)
app.post('/api/admin/locations', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    const others = await Location.find({}, { name: 1, shortCode: 1 }).lean();
    const { record, errors } = parseLocationBody(req.body, { others });
    if (errors) return locationError(res, errors);

    const location = new Location({ ...record, editedBy: req.user?.username || '', editedAt: new Date() });
    await applyLocationGeocode(location);
    try {
      await location.save();
    } catch (err) {
      // Two people adding the same short name at once — the unique index wins.
      if (err?.code === 11000) return locationError(res, { name: `${record.name} already exists` });
      throw err;
    }

    req.app.get('io').emit('location_update');
    res.status(201).json(location);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create location', error: error.message });
  }
});

// Update a location (manage_users permission needed). Everything but the
// short name is editable — the name is the key stored on users, check-ins,
// daily reports, etc., so renaming would orphan those records.
app.patch('/api/admin/locations/:id', verifyAnyAuth, checkPermission('manage_users'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Location not found' });
    }
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const others = await Location.find({}, { name: 1, shortCode: 1 }).lean();
    const { record, errors } = parseLocationBody(req.body, { isEdit: true, current: location, others });
    if (errors) return locationError(res, errors);

    location.set({ ...record, editedBy: req.user?.username || '', editedAt: new Date() });
    await applyLocationGeocode(location);
    await location.save();

    req.app.get('io').emit('location_update');
    res.json(location);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update location', error: error.message });
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
    // Nothing may keep pointing at it as their regional distribution center.
    await Location.updateMany({ rdc: location.name }, { $set: { rdc: '' } });
    
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
    // authenticate has just read this user (and their role's permissions)
    // fresh from the DB in one query; reusing it saves a second round trip
    // to Atlas on every page load. Falls back to a lookup if it's missing.
    const user = req.authUserDoc || await User.findById(req.userId).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

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
      routePlannerFilters: user.routePlannerFilters || {},
      // Side nav pins; the first one they can open is their landing tab.
      pinnedTabs: user.pinnedTabs || []
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
app.use('/api/user/me/pinned-tabs', createPinnedTabsRouter({ authenticate }));
// The side nav's admin-set order, for everyone (src/routes/navOrder.js).
app.use('/api/nav-order', createNavOrderRouter({ authenticate, requirePermission }));
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

    // Every database call here is a full round trip to the Atlas cluster
    // (~280ms from the US — it's in ap-south-1), so this route keeps them few
    // and parallel: two trips for a normal sign-in, down from five. There
    // used to be a Customer.countDocuments() "connection check" first, which
    // was one whole trip that decided nothing.

    // Find customer or internal user
    const loginIdentifier = email ? email.trim().toLowerCase() : '';
    console.log(`[${new Date().toISOString()}] 🔍 DB QUERY START: Finding account for "${loginIdentifier}" (Original: "${email}")`);
    const startQuery = Date.now();
    let account;
    let accountType = 'customer';
    let permissions = [];

    try {
      // Both lists at once, not customers-then-staff: a staff username never
      // matches a customer, so the old order spent a round trip on every
      // staff sign-in. Neither can be skipped by shape — 18 customers sign in
      // with an email field that has no "@". A customer match still wins,
      // as before, if somehow both match.
      const [customerAccount, staffAccount] = await Promise.all([
        Customer.findOne({ email: loginIdentifier }).select('-visits -resources'),
        User.findOne({
          $or: [
            { email: loginIdentifier },
            { username: loginIdentifier }
          ]
        })
      ]);
      account = customerAccount || staffAccount;
      if (!customerAccount && staffAccount) {
        accountType = 'internal';
      }

      console.log(`[${new Date().toISOString()}] ⏱️ DB QUERY END: Took ${Date.now() - startQuery}ms`);

      if (!account) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Check if account is locked
      if (typeof account.isLocked === 'function' && account.isLocked()) {
        return res.status(423).json({ message: 'Account locked. Please try again later.' });
      }

      // Verify password — with a staff account's role permissions fetched
      // alongside it rather than after, since bcrypt (~110ms) is pure CPU
      // and the role lookup is a round trip either way. On a wrong password
      // the permissions are just discarded.
      const [isMatch, staffRole] = await Promise.all([
        account.comparePassword(password),
        accountType === 'internal' ? Role.findOne({ name: account.role }) : null
      ]);
      permissions = staffRole?.permissions || [];

      if (!isMatch) {
        if (typeof account.incLoginAttempts === 'function') {
          await account.incLoginAttempts();
        }
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Deactivated — a staff user in Users & Roles, or a customer under
      // Account & Security (whose switch, until now, never stopped them
      // signing in). After the password check, so it can't probe which
      // accounts exist. Missing = active.
      if (account.isActive === false) {
        return res.status(403).json({ message: 'This account has been deactivated. Contact Easy Stones for help.' });
      }
      // A staff account still on its temporary password finishes on the staff
      // sign-in page, which is where choosing their own password happens.
      if (accountType === 'internal' && account.mustChangePassword) {
        return res.status(403).json({
          code: 'must-change-password',
          message: 'Finish setting up your account on the staff sign-in page (/admin/login), where you’ll choose your own password.'
        });
      }
    } catch (dbError) {
      console.error(`[${new Date().toISOString()}] ❌ DB ERROR during account lookup:`, dbError);
      throw dbError;
    }

    // Clear failed attempts, and record a customer's sign-in IP — one write
    // at most. This used to be a resetLoginAttempts() write followed by a
    // second update setting the same fields again, run on every sign-in; a
    // staff account with nothing to clear now writes nothing at all.
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (accountType === 'customer') {
      console.log(`💾 Updating customer login info (IP: ${ip}) for ${email}`);
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
    } else if (account.loginAttempts > 0 || account.lockUntil) {
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

    const userId = req.authType === 'admin' ? req.userId : req.customerId;
    // view_all_visits: everything. view_branch_visits: every rep's visits, for
    // customers in their assigned branches. Neither: what they logged. Set per
    // role under Users & Roles → Visits; see dashboardScope in
    // src/utils/dashboardMatch.js.
    // ?location= is the dashboard's location filter, so the tiles count what
    // the list below them shows; it can only narrow.
    const scope = narrowScopeToLocation(
      dashboardScope({ permissions: req.user?.permissions, userId, assignedLocations: req.user?.assignedLocations }),
      req.query.location
    );
    const branchPrefilter = scopeBranchPrefilter(scope);
    const branchStage = branchPrefilter ? [branchPrefilter] : [];
    const userMatchObj = scopeVisitUserMatch(scope);
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
      ...branchStage,
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
      ...branchStage,
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      { $match: followUpDateMatchScoped },
      { $count: "count" }
    ]);

    // Today's Schedule count

    const scheduleCountQuery = Customer.aggregate([
      ...branchStage,
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

    // Resources follow the same scope as visits: only "own" narrows to what
    // this person uploaded (it used to apply to everyone, admins included).
    const resourceRange = getAggregationRangeMatch(startDate, endDate, "resources");
    const resourcePrefilter = rangePrefilter(startDate, endDate, 'resources');
    const resourceStatsQuery = Customer.aggregate([
      ...branchStage,
      ...(resourcePrefilter ? [resourcePrefilter] : []),
      ...slimForUnwind('resources'),
      { $unwind: "$resources" },
      {
        $match: {
          $expr: {
            $and: [
              scope.kind === 'own'
                ? {
                    $or: [
                      { $eq: [{ $toString: "$resources.uploadedBy" }, userId.toString()] },
                      { $eq: [{ $toString: "$resources.createdBy" }, userId.toString()] }
                    ]
                  }
                : { $literal: true },
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

    const userId = req.authType === 'admin' ? req.userId : req.customerId;
    // view_all_visits: everything. view_branch_visits: every rep's visits, for
    // customers in their assigned branches. Neither: what they logged. Set per
    // role under Users & Roles → Visits; see dashboardScope in
    // src/utils/dashboardMatch.js.
    // ?location= is the dashboard's location filter; it can only narrow.
    const scope = narrowScopeToLocation(
      dashboardScope({ permissions: req.user?.permissions, userId, assignedLocations: req.user?.assignedLocations }),
      req.query.location
    );
    const branchPrefilter = scopeBranchPrefilter(scope);
    const branchStage = branchPrefilter ? [branchPrefilter] : [];
    const userMatchObj = scopeVisitUserMatch(scope);

    // Handle fallback logic for matching
    const dateMatch = filterType === 'followup'
      ? getFollowUpRangeMatch(startDate, endDate, userMatchObj)
      : getAggregationRangeMatch(startDate, endDate, "visits", userMatchObj);

    // Filter and slim customers before $unwind (src/utils/dashboardMatch.js).
    // Follow-ups have no early filter: getFollowUpRangeMatch also counts an
    // entry whose follow-up fields are missing, so nearly every visit passes.
    const visitPrefilter = filterType === 'followup' ? null : rangePrefilter(startDate, endDate, 'visits');
    const visits = await Customer.aggregate([
      ...branchStage,
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
          },
          // Separately too, for the list + detail view (VisitsListDetail.jsx):
          // company over contact, the customer's branch, and who logged it.
          // Photos aren't here — the detail fetches them for the one visit
          // being looked at, so this list stays small.
          company: "$company",
          contactName: "$contactName",
          location: "$location",
          createdByName: "$visits.createdByName"
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
    // Same scope as the visits list (dashboardScope): view_all_visits sees every
    // resource, view_branch_visits their branches', anyone else only what they
    // uploaded.
    // This used to narrow everyone — admins included — to their own uploads.
    // ?location= is the dashboard's location filter; it can only narrow.
    const scope = narrowScopeToLocation(
      dashboardScope({ permissions: req.user?.permissions, userId, assignedLocations: req.user?.assignedLocations }),
      req.query.location
    );
    const branchPrefilter = scopeBranchPrefilter(scope);

    const rangeMatch = getAggregationRangeMatch(startDate, endDate, "resources");

    const resourceMatchStage = {
      $expr: {
        $and: [
          scope.kind === 'own'
            ? {
                $or: [
                  { $eq: [{ $toString: "$resources.uploadedBy" }, userId.toString()] },
                  { $eq: [{ $toString: "$resources.createdBy" }, userId.toString()] }
                ]
              }
            : { $literal: true },
          (rangeMatch.$expr || { $literal: true })
        ]
      }
    };

    const resourcePrefilter = rangePrefilter(startDate, endDate, 'resources');
    const resources = await Customer.aggregate([
      ...(branchPrefilter ? [branchPrefilter] : []),
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
// Every customer route lives under /api/customers (2026-10-06). Only a real id
// reaches this one, so /api/customers/list, /cities and /view-counts — which
// are registered further down — get to their own handlers.
const customerIdOnly = (req, res, next) => (/^[a-f0-9]{24}$/i.test(req.params.id) ? next() : next('route'));
app.get('/api/customers/:id', customerIdOnly, authenticate, requirePermission('view_customers'), async (req, res) => {
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
// kept alongside delete_customers, same reasoning as DELETE /api/customers/:id
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
// The staff directory (names, usernames, emails, roles) — for staff screens
// only. authenticate also admits customer logins, which used to be handed
// the whole list.
app.get('/api/salesreps', authenticate, async (req, res) => {
  if (req.user?.type === 'customer') {
    return res.status(403).json({ error: 'Access denied.' });
  }
  try {
    const cached = cacheHit('salesreps');
    if (cached) return res.json(cached);

    const [users, driverRoles] = await Promise.all([
      User.find({}, 'username displayName email role location assignedLocations isActive'),
      // Roles with Delivery Schedule → Driver view: their users are the truck
      // columns on the delivery board (src/api/deliverySchedule.js). Sent as a
      // flag per user rather than every user's permission list.
      Role.find({ permissions: 'delivery_driver_view' }, 'name').lean()
    ]);
    const driverRoleNames = new Set(driverRoles.map(r => r.name));
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
      assignedLocations: user.assignedLocations || [],
      isDeliveryDriver: driverRoleNames.has(user.role),
      // Deactivated in Users & Roles: kept in this list so their name still
      // shows on what they did, but offered for nothing new.
      isActive: user.isActive !== false
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
app.get(['/api/customers/cities', '/api/partners/cities'], authenticate, requirePermission('view_customers'), async (req, res) => {
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
// The customer list (Customers page). /api/partners is the old address, kept
// until cached apps have updated.
app.get(['/api/customers/list', '/api/partners'], authenticate, requirePermission('view_customers'), async (req, res) => {
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
    const filterView = isSavedView(req.query.view) ? req.query.view : '';
    const filterLetter = req.query.letter || '';
    const filterModa = req.query.moda || '';
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
          { 'address.city': { $regex: safeSearch, $options: 'i' } },
          { 'address.street': { $regex: safeSearch, $options: 'i' } },
          { status: { $regex: safeSearch, $options: 'i' } }
        ]
      });
    }

    // Saved views (My accounts, Follow-ups due, …) — one preset filter each,
    // defined with the screen in src/utils/customerList.js.
    if (filterView) {
      filterConditions.push(savedViewQuery(filterView, {
        userId: req.userId,
        today: pacificToday(),
        toId: (id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null)
      }));
    }

    // A–Z jump strip.
    const letterCondition = letterQuery(filterLetter);
    if (letterCondition) filterConditions.push(letterCondition);

    // Moda Resources: display = 'Yes'/'No', binders = a count stored as a string.
    if (filterModa) {
      const wanted = filterModa.split(',').map(m => m.trim());
      const modaOrs = [];
      if (wanted.includes('display')) modaOrs.push({ modaDisplay: 'Yes' });
      if (wanted.includes('noDisplay')) modaOrs.push({ modaDisplay: { $ne: 'Yes' } });
      if (wanted.includes('binders')) modaOrs.push({ modaBinder: { $nin: [null, '', '0'] } });
      if (wanted.includes('noBinders')) modaOrs.push({ modaBinder: { $in: [null, '', '0'] } });
      if (modaOrs.length) filterConditions.push(modaOrs.length === 1 ? modaOrs[0] : { $or: modaOrs });
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

    // The list shows "+N" for extra contacts without shipping the contacts
    // themselves, so count them before they're projected away.
    const countContacts = { $addFields: { contactsCount: { $size: { $ifNull: ['$contacts', []] } } } };

    const customers = await Customer.aggregate(
      limit === -1
        ? [{ $match: query }, sortFields, { $sort: sortStage }, countContacts, hideHeavyFields]
        : [{ $match: query }, sortFields, { $sort: sortStage }, { $skip: skip }, { $limit: limit }, countContacts, hideHeavyFields]
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

// The Fabricators / Partners tab, as a query. Same rule as the type/typeExclude
// handling in GET /api/partners: a record with no type is a Fabricator.
const partnersTabQuery = (tab) => (tab === 'partners'
  ? {
    $and: [
      { customerType: { $exists: true } },
      { customerType: { $ne: null } },
      { customerType: { $ne: '' } },
      { customerType: { $not: { $regex: /^fabricator$/i } } }
    ]
  }
  : {
    $or: [
      { customerType: { $regex: /^fabricator$/i } },
      { customerType: null },
      { customerType: { $exists: false } },
      { customerType: '' }
    ]
  });

// Counts for the customer list's saved views, within one tab.
app.get(['/api/customers/view-counts', '/api/partners/view-counts'], authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const base = partnersTabQuery(req.query.tab);
    const opts = {
      userId: req.userId,
      today: pacificToday(),
      toId: (id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null)
    };
    const entries = await Promise.all(SAVED_VIEWS.map(async ({ key }) =>
      [key, await Customer.countDocuments({ $and: [base, savedViewQuery(key, opts)] })]
    ));
    res.json(Object.fromEntries(entries));
  } catch (error) {
    console.error('Error counting customer views:', error);
    res.status(500).json({ message: 'Failed to count customer views' });
  }
});

// Bulk "Assign rep" / "Set status" from the customer list's selection bar.
// Only these two fields, so a selection can't be used to rewrite anything else.
app.patch(['/api/customers/bulk', '/api/partners/bulk'], authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({ message: 'Choose at least one customer' });
    }
    if (validIds.length > 500) {
      return res.status(400).json({ message: 'Too many customers in one change (500 max)' });
    }

    const update = {};
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ message: 'Unknown status' });
      }
      update.status = req.body.status;
    }
    if (req.body.salesRep !== undefined) {
      // Same resolution as a single edit: the stored name always matches the id,
      // and an empty value hands the accounts back (unassigns them). An id that
      // names nobody is refused — resolveSalesRep would read it as "unassign",
      // and across a whole selection that mistake is expensive.
      const rep = await resolveSalesRep(req.body.salesRep);
      if (req.body.salesRep && !rep.salesRep) {
        return res.status(400).json({ message: 'That sales rep was not found' });
      }
      Object.assign(update, rep);
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'Nothing to change' });
    }

    const result = await Customer.updateMany({ _id: { $in: validIds } }, { $set: update });
    req.app.get('io').emit('customer_update');
    res.json({ matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error) {
    console.error('Error bulk-updating customers:', error);
    res.status(500).json({ message: 'Failed to update customers' });
  }
});

// Possible duplicates of a customer being added (or edited), by the same
// signals the import and the duplicate audit use. Returns the strong matches
// only — a shared email domain alone isn't worth interrupting someone for.
app.post(['/api/customers/possible-duplicates', '/api/partners/possible-duplicates'], authenticate, requirePermission('view_customers'), async (req, res) => {
  try {
    const probe = {
      company: String(req.body?.company || ''),
      phone: String(req.body?.phone || ''),
      email: String(req.body?.email || '')
    };
    const excludeId = String(req.body?.excludeId || '');
    const rows = await Customer.find({}, 'company phone email notDuplicateOf').lean();
    const index = buildSignalIndex(rows);
    const separated = new Set(
      (rows.find(r => String(r._id) === excludeId)?.notDuplicateOf || []).map(String)
    );
    const hits = matchAgainst(index, probe)
      .filter(h => h.id !== excludeId && !separated.has(h.id) && h.score >= STRONG)
      .slice(0, 3);
    if (hits.length === 0) return res.json({ matches: [] });

    const found = await Customer.find(
      { _id: { $in: hits.map(h => h.id) } },
      'company contactName name phone email status location salesRepName address city'
    ).lean();
    const byId = new Map(found.map(c => [String(c._id), c]));
    res.json({
      matches: hits
        .filter(h => byId.has(h.id))
        .map(h => ({ customer: byId.get(h.id), signals: h.signals, score: h.score }))
    });
  } catch (error) {
    console.error('Error checking for duplicate customers:', error);
    res.status(500).json({ message: 'Failed to check for duplicates' });
  }
});

// Create a new lead (as a Customer)
// Create a customer — the one create route for every screen (Add customer and
// the visit form's "New customer" via SalesPage, the Customers page, the route
// planner's "save as lead"). /api/sales/customers and /api/partners are the
// old addresses of the two creates this replaced, kept until cached apps have
// updated. The fields allowed and their defaults are in customerRecord.js;
// the rep's name and the map point are derived here, never taken from the body.
app.post(['/api/customers', '/api/sales/customers', '/api/partners'], authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const { fields, error } = newCustomerFields(req.body);
    if (error) return res.status(400).json({ message: error });

    const rep = await resolveSalesRep(req.body.salesRep);

    // A point the caller already has (the route planner's Places result) is
    // used as is; otherwise the address is geocoded. An address that can't be
    // resolved still saves, it just has no pin yet.
    const point = suppliedPoint(req.body.coordinates);
    const geo = point
      ? {
        coordinates: point,
        geocode: {
          status: 'ok',
          precision: Object.values(GEOCODE_PRECISION).includes(req.body.precision) ? req.body.precision : GEOCODE_PRECISION.APPROXIMATE,
          formattedAddress: '',
          addressKey: addressKeyOf(fields.address),
          updatedAt: new Date(),
          error: ''
        }
      }
      : await geocodeAddress(fields.address);

    const newCustomer = new Customer({ ...fields, ...rep, ...geo, createdBy: req.userId });
    await newCustomer.save();
    req.app.get('io').emit('customer_update');
    res.status(201).json(newCustomer);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A customer with this email already exists.' });
    }
    console.error('Error creating customer:', error);
    res.status(400).json({ message: error.message });
  }
});

// Edit a customer (also a status-only change). /api/partners/:id is the old
// address. Password, login state, the map point and the rep's name are never
// taken from the body (customerUpdateFields) — findByIdAndUpdate skips the
// schema's bcrypt hook, so a password sent here used to be stored as typed.
app.put(['/api/customers/:id', '/api/partners/:id'], authenticate, requirePermission('manage_customers'), async (req, res) => {
  try {
    const updateData = customerUpdateFields(req.body);

    // Only touch the rep when the edit actually carried one, so a partial update
    // cannot silently unassign an account. When it did, both halves are rewritten
    // together — including clearing the cached name as the rep is cleared, rather
    // than leaving a name behind pointing at nobody.
    if (req.body.salesRep !== undefined) {
      Object.assign(updateData, await resolveSalesRep(req.body.salesRep));
    }

    // Needed twice below: the stored address, because findByIdAndUpdate replaces
    // a nested object wholesale and a city-only edit would otherwise drop the
    // street; and the key the stored point came from, because re-geocoding is
    // only worth paying for when the address actually moved.
    const existing = await Customer.findById(req.params.id).select('address geocode').lean();
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (req.body.address) {
      updateData.address = addressFrom(req.body);
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
app.delete(['/api/customers/:id', '/api/partners/:id'], authenticate, requireAnyPermission('manage_customers', 'delete_customers'), async (req, res) => {
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
app.post('/api/customers/:customerId/visits', authenticate, requirePermission('add_visits'), async (req, res) => {
  try {
    const { customerId } = req.params;
    const { date, purpose, notes, outcome, followUp, followUpDate, managerComment, headquartersComment, image } = req.body;



    // Only a real YYYY-MM-DD date is stored — these feed date-range queries and
    // the calendar link (src/utils/visitDates.js has why).
    const processedDate = normalizeVisitDate(date);
    const processedFollowUpDate = normalizeOptionalDate(followUpDate);
    if (!processedDate || !purpose) {
      return res.status(400).json({ message: 'A visit date (YYYY-MM-DD) and a purpose are required' });
    }
    if (processedFollowUpDate === null) {
      return res.status(400).json({ message: 'Follow-up date must be a date (YYYY-MM-DD)' });
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
      date: processedDate,
      purpose,
      notes,
      outcome,
      followUp,
      followUpDate: processedFollowUpDate,
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
app.put('/api/customers/:customerId/visits/:visitId', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), async (req, res) => {
  try {
    const { customerId, visitId } = req.params;
    const { date, purpose, notes, outcome, followUp, followUpDate, managerComment, headquartersComment, image } = req.body;

    const updateData = {};
    if (date) {
      const processedDate = normalizeVisitDate(date);
      if (!processedDate) return res.status(400).json({ message: 'Visit date must be a date (YYYY-MM-DD)' });
      updateData['visits.$.date'] = processedDate;
    }
    if (followUpDate !== undefined) {
      const processedFollowUpDate = normalizeOptionalDate(followUpDate);
      if (processedFollowUpDate === null) return res.status(400).json({ message: 'Follow-up date must be a date (YYYY-MM-DD)' });
      updateData['visits.$.followUpDate'] = processedFollowUpDate;
    }

    // Who may change this visit (src/utils/visitAccess.js) — checked before
    // any image upload or write. The same read tells the calendar sync below
    // whether the date moved and who logged the visit.
    const existing = await Customer.findOne(
      { _id: customerId, 'visits._id': visitId },
      { 'visits.$': 1, location: 1 }
    ).lean();
    const before = existing?.visits?.[0];
    if (!before) return res.status(404).json({ message: 'Customer or visit not found' });
    if (!canModifyVisit({ id: req.userId, permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations }, before, existing.location)) {
      return res.status(403).json({ message: "You don't have permission to edit this visit. You can edit visits you logged; anything else needs a Visits permission under Users & Roles." });
    }

    const { id: updatedBy, name: updatedByName } = await getPerformerInfo(req);

    if (purpose !== undefined) updateData['visits.$.purpose'] = purpose;
    if (notes !== undefined) updateData['visits.$.notes'] = notes;
    if (outcome !== undefined) updateData['visits.$.outcome'] = outcome;
    if (followUp !== undefined) updateData['visits.$.followUp'] = followUp;
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

    const result = await Customer.updateOne(
      { _id: customerId, 'visits._id': visitId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or visit not found' });
    }

    res.json({ success: true, message: 'Visit updated successfully' });

    // Background: a visit moved to another day takes its calendar entry along.
    if (updateData['visits.$.date'] && before.date !== updateData['visits.$.date']) {
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
app.delete('/api/customers/:customerId/visits/:visitId', authenticate, requireAnyPermission(...ANY_DELETE_VISIT_PERMISSIONS), async (req, res) => {
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
    // Delete has its own permissions (src/utils/visitAccess.js).
    if (visit && !canDeleteVisit({ id: req.userId, permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations }, visit, customer.location)) {
      return res.status(403).json({ message: "You don't have permission to delete this visit. You can delete visits you logged; anything else needs a Visits permission under Users & Roles." });
    }
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
app.post('/api/customers/:customerId/resources', authenticate, requirePermission('add_visits'), async (req, res) => {
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

    // A placement writes a visit with this date, so it gets the same check.
    const resourceDateStr = date ? normalizeVisitDate(date) : ensureDateString(new Date());
    if (!resourceDateStr) return res.status(400).json({ message: 'Resource date must be a date (YYYY-MM-DD)' });

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
// A resource follows the visit rules (canModifyVisit / canDeleteVisit), with
// whoever uploaded it standing in for whoever logged the visit.
const resourceAccessArgs = (req, resource) => [
  { id: req.userId, permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations },
  { createdBy: resource.uploadedBy || resource.createdBy }
];
const canModifyResource = (req, resource, customerLocation) => canModifyVisit(...resourceAccessArgs(req, resource), customerLocation);
const canDeleteResource = (req, resource, customerLocation) => canDeleteVisit(...resourceAccessArgs(req, resource), customerLocation);

app.put('/api/customers/:customerId/resources/:resourceId', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;
    const updateData = {};
    const fields = { ...req.body };
    // The resource's date is copied onto its placement visit; validate it once here.
    if (fields.date !== undefined && fields.date !== '') {
      const normalized = normalizeVisitDate(fields.date);
      if (!normalized) return res.status(400).json({ message: 'Resource date must be a date (YYYY-MM-DD)' });
      fields.date = normalized;
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const existingResource = customer.resources ? customer.resources.id(resourceId) : null;
    const oldTitle = existingResource ? (existingResource.title || existingResource.resourceType) : '';
    // Not on this customer: the client is moving it here (see below), from
    // whichever customer holds it now.
    const source = existingResource ? null : await Customer.findOne({ 'resources._id': resourceId });
    const moving = source ? source.resources.id(resourceId) : null;
    // Same rule as visits (src/utils/visitAccess.js), checked against the
    // customer the resource is on now — a move used to skip this entirely.
    const current = existingResource || moving;
    if (current && !canModifyResource(req, current, (existingResource ? customer : source).location)) {
      return res.status(403).json({ message: "You don't have permission to edit this resource. You can edit resources you uploaded; anything else needs a Visits permission under Users & Roles." });
    }

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
app.delete('/api/customers/:customerId/resources/:resourceId', authenticate, requireAnyPermission(...ANY_DELETE_VISIT_PERMISSIONS), async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const resource = customer.resources ? customer.resources.id(resourceId) : null;
    const titleToMatch = resource ? (resource.title || resource.resourceType) : '';
    if (resource && !canDeleteResource(req, resource, customer.location)) {
      return res.status(403).json({ message: "You don't have permission to delete this resource. You can delete resources you uploaded; anything else needs a Visits permission under Users & Roles." });
    }

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
app.post(['/api/customers/duplicates/resolve', '/api/admin/customers/duplicates/resolve'], verifyToken, requirePermission('manage_customers'), async (req, res) => {
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
app.post(['/api/customers/duplicates/undo', '/api/admin/customers/duplicates/undo'], verifyToken, requirePermission('manage_customers', 'delete_customers'), async (req, res) => {
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
app.post(['/api/customers/import/preview', '/api/admin/customers/import/preview'], verifyToken, requirePermission('manage_customers'), uploadMemory.single('file'), async (req, res) => {
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
app.delete(['/api/customers/import/memory', '/api/admin/customers/import/memory'], verifyToken, requirePermission('manage_customers'), async (req, res) => {
  try {
    await ImportMemory.deleteOne({ kind: 'customer' });
    res.json({ success: true });
  } catch (error) {
    console.error('Customer import memory reset error:', error);
    res.status(500).json({ message: `Could not forget saved choices: ${error.message}` });
  }
});

// Rows per database round trip when an import is written.
const IMPORT_WRITE_BATCH = 500;

/**
 * Carry out an import. Rows flagged for review are never written — that is the
 * whole point of flagging them.
 */
app.post(['/api/customers/import/apply', '/api/admin/customers/import/apply'], verifyToken, requirePermission('manage_customers'), uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const plan = await planCustomerImport(req);
    const results = { created: 0, updated: 0, skipped: 0, errors: [] };
    // rowNumber → new customer id, so a "create it" review decision can be
    // remembered as the record it made (see saveImportMemory).
    const createdByRow = new Map();
    const rowError = (row, message) => results.errors.push(`Row ${row.rowNumber} (${row.label || ''}): ${message}`);

    // Written in batches, not one customer at a time. Each row used to cost
    // two bcrypt hashes (~0.1s of CPU apiece, stalling every other request on
    // the server) plus its own database round trip — about half a second a
    // row against the remote database, so a 4,000-customer file ran for most
    // of an hour.
    //
    // Every new customer gets the same starting password, so it's hashed once
    // here. insertMany skips the model's pre('save') hook, which is also what
    // stops it being hashed a second time: .save() used to re-hash this
    // already-hashed value, so imported customers couldn't sign in with it.
    const creates = plan.planned.filter(r => r.action === 'create');
    const updates = plan.planned.filter(r => r.action === 'update');
    results.skipped = plan.planned.length - creates.length - updates.length;

    if (creates.length) {
      const startingPassword = await bcrypt.hash('Welcome123!', 10);
      const docs = [];
      const docRows = [];
      for (const row of creates) {
        const doc = new Customer({ ...row.create, password: startingPassword });
        const invalid = doc.validateSync();
        if (invalid) { rowError(row, invalid.message); continue; }
        docs.push(doc);
        docRows.push(row);
      }
      // Batches resent if the connection drops mid-write; each document
      // already has its _id, so a resend can't create anyone twice
      // (src/utils/dbRetry.js). Rows refused for their data (a duplicate
      // email, say) come back by index and don't stop the rest.
      const refused = await insertInBatches(Customer, docs, { batchSize: IMPORT_WRITE_BATCH });
      docs.forEach((doc, i) => {
        const row = docRows[i];
        if (refused.has(i)) { rowError(row, refused.get(i)); return; }
        createdByRow.set(row.rowNumber, String(doc._id));
        results.created++;
      });
    }

    for (let start = 0; start < updates.length; start += IMPORT_WRITE_BATCH) {
      const batch = updates.slice(start, start + IMPORT_WRITE_BATCH);
      const failed = new Map();
      // $set is safe to send twice, so a dropped connection just resends it.
      await withDbRetry(async () => {
        failed.clear();
        try {
          await Customer.bulkWrite(
            batch.map(row => ({ updateOne: { filter: { _id: row.targetId }, update: { $set: row.apply } } })),
            { ordered: false }
          );
        } catch (err) {
          // A dropped connection (a bulk write error listing no rows) fails
          // the whole batch — throw, so withDbRetry resends it.
          if (!hasRowErrorsOnly(err)) throw err;
          for (const we of err.writeErrors) failed.set(we.index ?? we.err?.index, we.errmsg || we.err?.errmsg || 'Could not be saved');
        }
      });
      batch.forEach((row, i) => {
        if (failed.has(i)) rowError(row, failed.get(i));
        else results.updated++;
      });
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

// ── INVENTORY ANALYSIS ──
// Lives in src/routes/inventoryAnalysis.js: the summary, stock list, reorder
// and velocity reads, and the SPS stock/sales imports. Mounted here, where the
// routes used to be, so their order among the other routes is unchanged.
app.use('/api/inventory-analysis', createInventoryAnalysisRouter({
  authenticate,
  requirePermission,
  uploadMemory
}));

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
// Password reset. Its own route (and permission) so the ordinary edit route
// never writes a password; customer.save() runs the schema's bcrypt hook.
app.put(['/api/customers/:id/password', '/api/admin/customers/:id'], verifyToken, requirePermission('manage_customer_accounts'), async (req, res) => {
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

// Lost sales are scoped to the branches a person is assigned ('*' = all), like
// the rest of the location filters. A record with no location is shown to
// everyone rather than to no one, the same call the delivery board makes.
const lostSaleLocationQuery = (user) => {
  const assigned = user?.assignedLocations || [];
  if (assigned.includes('*')) return {};
  return { $or: [{ location: { $in: [...assigned, ''] } }, { location: null }, { location: { $exists: false } }] };
};
const canAccessLostSaleLocation = (user, location) => {
  const assigned = user?.assignedLocations || [];
  return assigned.includes('*') || !location || assigned.includes(location);
};

// GET /api/lost-sales: Fetch the lost sales for the branches this person may see
app.get('/api/lost-sales', verifyAnyAuth, async (req, res) => {
  try {
    const list = await LostSale.find(lostSaleLocationQuery(req.user)).sort({ date: -1, createdAt: -1 }).lean();
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

    if (!canAccessLostSaleLocation(req.user, data.location || 'Seattle')) {
      return res.status(403).json({ message: 'You do not have access to that location' });
    }

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

    if (!canAccessLostSaleLocation(req.user, data.location)) {
      return res.status(403).json({ message: 'You do not have access to that location' });
    }

    // findByIdAndUpdate skips validators by default, so an edit could store a
    // `reason` outside the schema enum that POST would have rejected.
    // Only a record this person can see — one at another branch reads as missing.
    const updated = await LostSale.findOneAndUpdate(
      { _id: req.params.id, ...lostSaleLocationQuery(req.user) },
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
    const deleted = await LostSale.findOneAndDelete({ _id: req.params.id, ...lostSaleLocationQuery(req.user) });
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
app.patch(['/api/customers/:id/active', '/api/admin/customers/:id/status'], verifyToken, requirePermission('manage_customer_accounts'), async (req, res) => {
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
// POST /api/sales/customers is now an alias of the one create route — see
// app.post(['/api/customers', …]) above.

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

