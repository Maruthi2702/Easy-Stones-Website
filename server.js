import dotenv from 'dotenv';
dotenv.config();
// Trigger restart for schema update (v2)

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

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
import SalesResource from './src/models/SalesResource.js';
import SalesDashboardResource from './src/models/SalesDashboardResource.js';
import ActivityLog from './src/models/ActivityLog.js';
import Schedule from './src/models/Schedule.js';
// Unified Model: Customer (now handles both Leads & Active Customers)
import OfficeCheckIn from './src/models/OfficeCheckIn.js';
import Delivery from './src/models/Delivery.js';
import Truck from './src/models/Truck.js';
import LostSale from './src/models/LostSale.js';
import { sendCheckInAlertEmail, sendSelectionSheetEmail, sendContactFormEmail } from './src/services/emailService.js';
import { discoverICloudCalendars, syncICloudCalendar } from './src/services/icloudSyncService.js';
import { stampSignaturesOnPdfBytes } from './src/utils/pdfSigner.js';
import { signedPackingListFileName } from './src/utils/packingList.js';
import createDailyReportsRouter from './src/routes/dailyReports.js';
import { startAutoSubmitDailyReports } from './src/jobs/autoSubmitDailyReports.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { read, utils } from 'xlsx';
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
};

const bustUserCaches = () => {
  memoryCache.salesreps.data = null;
  memoryCache.salesreps.lastFetched = 0;
};

// Base64 to Cloudinary Upload Utility (persistent across restarts)
// Falls back to disk only if Cloudinary is not configured (local dev without .env)
const processBase64Image = async (base64String, subDir = 'Visits') => {
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

// ─── Delivery document storage ──────────────────────────────────────────────
//
// Packing lists, signatures and signed PDFs are keyed on the delivery id rather
// than a timestamp. Re-signing therefore overwrites in place instead of leaving
// the previous copy stranded in Cloudinary with nothing pointing at it, so a
// delivery costs a fixed number of assets no matter how often it is re-signed,
// and deleting one is a direct address rather than a search.
const cloudinaryReady = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

// Cloudinary public_ids allow a limited character set; delivery ids are
// generated strings but may carry separators we shouldn't pass through raw.
const safeIdSegment = (value) => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

const podAssetIds = (deliveryId) => {
  const key = safeIdSegment(deliveryId);
  return {
    packingList: `deliveries/packing_lists/${key}`,
    signedPdf: `deliveries/pod/${key}/signed`,
    custSig: `deliveries/pod/${key}/sig_customer`,
    driverSig: `deliveries/pod/${key}/sig_driver`
  };
};

const uploadBufferToCloudinary = (buffer, publicId, resourceType = 'raw') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: resourceType, overwrite: true, invalidate: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

const destroyCloudinaryAsset = async (publicId, resourceType = 'raw') => {
  if (!publicId || !cloudinaryReady()) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  } catch (err) {
    console.warn(`[pod] could not destroy ${publicId}:`, err.message);
  }
};

// Writes a PDF buffer and returns { url, publicId }. Without Cloudinary
// configured this falls back to disk so local dev still works — but on Render
// that directory is wiped by every deploy, which is why the warning is loud.
const storeDeliveryPdf = async (buffer, publicId, diskName) => {
  if (cloudinaryReady()) {
    const result = await uploadBufferToCloudinary(buffer, publicId, 'raw');
    return { url: result.secure_url, publicId: result.public_id };
  }

  console.warn('⚠️ Cloudinary not configured — writing delivery PDF to disk (lost on restart)');
  const dir = path.join(process.cwd(), 'public/uploads/packing_lists');
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, diskName), buffer);
  return { url: `/uploads/packing_lists/${diskName}`, publicId: '' };
};

// Signature pads produce 340x130 line art on transparency. The shared image
// helper re-encodes everything to WebP at up to 1200px, which is the wrong
// trade here — trimming the empty margin and keeping PNG is both smaller and
// keeps the clean alpha that stamping depends on.
const storeSignaturePng = async (dataUrl, publicId) => {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl || '';

  let buffer = Buffer.from(dataUrl.split(';base64,').pop(), 'base64');
  try {
    const sharp = (await import('sharp')).default;
    buffer = await sharp(buffer).trim({ threshold: 10 }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    // A pad with no strokes trims to nothing and throws — keep the raw canvas PNG.
  }

  if (!cloudinaryReady()) return dataUrl;
  const result = await uploadBufferToCloudinary(buffer, publicId, 'image');
  return result.secure_url;
};

// The board's list fetch strips signatures and photos for speed, so any save
// that echoes a delivery straight back — a status change, a reschedule, a drag
// between trucks — carries a pod with those fields missing. Because $set
// replaces the whole subdocument, that used to wipe the signatures off a signed
// delivery. Absent means "unchanged" here; erasing a proof is what
// DELETE /api/deliveries/:id/pod is for.
const POD_PRESERVED_KEYS = [
  'customerSignature', 'driverSignature', 'photos', 'signeeName', 'driverName',
  'customerSignedAt', 'driverSignedAt', 'signedAt',
  'signedPdfUrl', 'signedPdfFilename', 'signedPdfPublicId',
  'clearedAt', 'clearedBy', 'clearReason'
];

const mergePodOntoExisting = (incoming = {}, existing = {}) => {
  const merged = { ...existing, ...incoming };
  for (const key of POD_PRESERVED_KEYS) {
    const value = incoming[key];
    // An explicit empty array still counts as intent (removing every photo);
    // a missing, null or blank value does not.
    const omitted = !(key in incoming) || value === undefined || value === null || value === '';
    if (omitted && existing[key] !== undefined) merged[key] = existing[key];
  }
  return merged;
};

// An ePOD counts as real only with a named signee and both signatures. Where a
// packing list exists it must also have produced a stamped copy — otherwise the
// card would advertise proof that leads to no document. A delivery with no
// packing list to begin with is still proven by the signatures alone; requiring
// a PDF there would leave it permanently reading "No ePOD" after a valid signing.
const derivePodVerified = (pod, hasPackingList) => Boolean(
  pod &&
  String(pod.signeeName || '').trim() &&
  pod.customerSignature &&
  pod.driverSignature &&
  (!hasPackingList || pod.signedPdfUrl)
);

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

io.on('connection', (socket) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔌 WebSockets: Client connected (${socket.id})`);
  }
  socket.on('disconnect', () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔌 WebSockets: Client disconnected (${socket.id})`);
    }
  });
});

const PORT = process.env.PORT || 3001;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Neutralise regex metacharacters before interpolating user input into a RegExp.
// Without this a search for "(" throws, and a crafted pattern can pin the CPU.
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Which day/month does this check-in belong to" has to be answered in some
// timezone. Callers pass the viewer's own zone (the browser reports it), so the
// counts and month filter line up with the dates that viewer sees on screen.
// Falls back to Pacific — where most branches are — when none is supplied.
const DEFAULT_TZ = 'America/Los_Angeles';

const zoneFormatters = new Map();
const zoneFormatter = (timeZone) => {
  if (!zoneFormatters.has(timeZone)) {
    zoneFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  return zoneFormatters.get(timeZone);
};

// Reject anything Intl won't accept, so a bad ?tz= can't throw mid-request.
const resolveTimeZone = (tz) => {
  if (!tz || typeof tz !== 'string') return DEFAULT_TZ;
  try {
    zoneFormatter(tz).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
};

// How far behind UTC the zone is at a given instant (resolves DST automatically).
// Reading the formatted parts back as if they were UTC keeps this independent of
// the server's own timezone — the round-trip-through-toLocaleString trick this
// replaced silently returned 0 whenever the host was already in that zone.
const zoneOffsetMs = (date, timeZone) => {
  const parts = {};
  for (const { type, value } of zoneFormatter(timeZone).formatToParts(date)) parts[type] = value;
  const wallClockAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return date.getTime() - wallClockAsUtc;
};

// The calendar date it currently is in the given zone.
const zoneDateParts = (date, timeZone) => {
  const parts = {};
  for (const { type, value } of zoneFormatter(timeZone).formatToParts(date)) parts[type] = value;
  return { year: Number(parts.year), monthIndex: Number(parts.month) - 1, day: Number(parts.day) };
};

// The UTC instant of midnight in the given zone on a calendar date. monthIndex is
// 0-based and Date.UTC handles rollover, so month 12 becomes the next January.
const zoneMidnightUtc = (timeZone, year, monthIndex, day = 1) => {
  const naive = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  const firstGuess = new Date(naive + zoneOffsetMs(new Date(naive), timeZone));
  // Re-derive using the offset actually in force at that instant so dates next
  // to a DST switch don't land an hour out.
  return new Date(naive + zoneOffsetMs(firstGuess, timeZone));
};

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
    // autoIndex is disabled on the connection, so a model missing from this list
    // silently runs with no indexes at all — Delivery/Truck/LostSale were absent,
    // which left the delivery board doing full collection scans and, worse, left
    // Delivery.id's unique constraint unenforced.
    // Settled individually so one model's failure (e.g. a pre-existing index with
    // conflicting options) can't mask or abort the rest.
    console.log('🔨 Syncing database indexes for scalability...');
    const indexTargets = [
      ['Customer', Customer], ['Product', Product], ['User', User],
      ['OfficeCheckIn', OfficeCheckIn], ['ActivityLog', ActivityLog], ['Schedule', Schedule],
      ['Delivery', Delivery], ['Truck', Truck], ['LostSale', LostSale],
      ['Location', Location], ['Role', Role], ['DailyReport', DailyReport]
    ];
    const indexResults = await Promise.allSettled(
      indexTargets.map(([, model]) => model.createIndexes())
    );
    indexResults.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`⚠️ Index sync failed for ${indexTargets[i][0]}: ${result.reason?.message || result.reason}`);
      }
    });
    if (indexResults.every(r => r.status === 'fulfilled')) {
      console.log('✅ Database indexes synchronized successfully');
    } else {
      console.log(`✅ Index sync complete (${indexResults.filter(r => r.status === 'fulfilled').length}/${indexTargets.length} models OK)`);
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
    // Kiosk users are managed dynamically by the administrator via the dashboard, no auto-seeding required.
    // Seed standard Roles & Permissions
    try {
      const defaultRoles = [
        {
          name: 'admin',
          displayName: 'Administrator',
          permissions: [
            'view_dashboard', 'view_customers', 'manage_customers', 'delete_customers',
            'view_checkins', 'manage_checkins', 'delete_checkins', 'send_checkin_email',
            'view_pricelist', 'manage_pricelist', 'manage_users', 'view_product_prices',
            'view_lost_sales', 'edit_lost_sales', 'delete_lost_sales',
            'view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'
          ],
          isSystem: true
        },
        {
          name: 'director',
          displayName: 'Director',
          permissions: [
            'view_dashboard', 'view_customers', 'manage_customers', 'delete_customers',
            'view_checkins', 'manage_checkins', 'delete_checkins', 'send_checkin_email',
            'view_pricelist', 'manage_pricelist', 'manage_users', 'view_product_prices',
            'view_lost_sales', 'edit_lost_sales', 'delete_lost_sales',
            'view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'
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
            'view_daily_report', 'edit_daily_report', 'submit_daily_report'
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
            'view_lost_sales', 'edit_lost_sales'
          ],
          isSystem: true
        },
        {
          name: 'csr',
          displayName: 'CSR',
          permissions: [
            'view_checkins', 'send_checkin_email', 'view_pricelist',
            'view_lost_sales'
          ],
          isSystem: true
        },
        {
          name: 'driver',
          displayName: 'Driver / Logistics',
          permissions: [
            'view_delivery_schedule', 'manage_delivery_schedule'
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
        { roles: ['admin', 'director'], permissions: ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'] }
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

// DEBUG ENDPOINT - REMOVE IN PRODUCTION
app.get('/api/debug/config', async (req, res) => {
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
    if (!origin) return callback(null, true);
    // Allow all origins for now to simplify deployment debugging, or restrict as needed
    // In production you might want to be stricter
    return callback(null, true);
  },
  credentials: true // Allow cookies
}));

// Compression middleware - reduces response sizes by 70-90%
app.use(compression());

app.use(express.json({ limit: '200mb' })); // Increase limit for large payloads (multiple images)
app.use(cookieParser());

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
      } catch (err) {
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
  } catch (err) {
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
  const token = req.cookies.adminToken;
  if (!token) {
    return res.status(401).json({ error: 'No active session' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ token, role: decoded.role, username: decoded.username });
  } catch (err) {
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
  } catch (error) {
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
  } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
      assignedLocations: user.assignedLocations || ['Seattle']
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to fetch user data' });
  }
});

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
  } catch (error) {
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
const customerAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies.customerToken;

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type === 'internal') {
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(401).json({ message: 'User no longer exists' });
      }
      req.user = user;
      req.accountType = 'internal';
    } else {
      const customer = await Customer.findById(decoded.id).select('-password');
      if (!customer) {
        return res.status(401).json({ message: 'Customer no longer exists' });
      }
      req.user = customer;
      req.accountType = 'customer';
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

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
      .select('_id company contactName firstName lastName email customerType city address street state zip shippingAddress shippingCity billingAddress billingCity')
      .sort({ company: 1, contactName: 1 })
      .lean();

    res.json(cachePut('customerDropdown', customers));
  } catch (error) {
    console.error('Error fetching customers for dropdown:', error);
    res.status(500).json({ message: 'Failed to fetch customers', error: error.message });
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

    // Aggregation for Visits Stats (Strictly by Visit Date)
    const visitStats = await Customer.aggregate([
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
    const followUpStats = await Customer.aggregate([
      { $unwind: "$visits" },
      { $match: followUpDateMatchScoped },
      { $count: "count" }
    ]);

    // Today's Schedule count
    // Today's Schedule count - Use UTC aligned "Today"
    const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
    const todayEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

    const scheduleCount = await Customer.aggregate([
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
    // Strictly filter by current user for dashboard resources
    const resourceUserFilter = {
      $or: [
        { "resources.uploadedBy": userId.toString() },
        { "resources.createdBy": userId.toString() }
      ]
    };

    const resourceRange = getAggregationRangeMatch(startDate, endDate, "resources");
    const resourceStats = await Customer.aggregate([
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
    const leadCount = await Customer.countDocuments({ 
      createdBy: userId, 
      status: { $exists: true } 
    });

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

    const visits = await Customer.aggregate([
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

    const { id: userId, role } = req.authType === 'admin' ? { id: req.userId, role: 'admin' } : { id: req.customerId, role: 'customer' };
    const isAdmin = ['admin', 'director', 'manager'].includes(role);

    const resourceMatchObj = {
      "resources.uploadedBy": userId.toString(),
      // Note: mixing OR inside $eq is complex, let's keep it simple or use $or if needed.
      // Actually, resourceMatch was using $or. 
      // In $expr, $or is different.
    };

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

    const resources = await Customer.aggregate([
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

// Remove customer association (bi-directional unlinking)
app.delete('/api/customers/:customerId/associations/:partnerId', authenticate, requirePermission('manage_customers'), async (req, res) => {
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


// Submit check-in (requires authenticated kiosk/staff session)
app.post('/api/checkin', authenticate, async (req, res) => {
  try {
    const { 
      name, 
      phone, 
      email, 
      fabricatorCompany, 
      fabricatorName, 
      fabricatorPhone,
      location: bodyLocation
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone number are required' });
    }

    let kioskLocation = 'Seattle';
    const userLocations = req.user?.assignedLocations || [];
    if (bodyLocation && (userLocations.includes('*') || userLocations.includes(bodyLocation))) {
      kioskLocation = bodyLocation;
    } else if (userLocations.length > 0) {
      const validLoc = userLocations.find(l => l !== '*');
      if (validLoc) {
        kioskLocation = validLoc;
      }
    }

    const checkIn = new OfficeCheckIn({
      name,
      phone,
      email,
      fabricatorCompany,
      fabricatorName,
      fabricatorPhone,
      location: kioskLocation,
      loggedBy: {
        userId: req.user?.id,
        displayName: req.user?.displayName || '',
        username: req.user?.username
      }
    });

    await checkIn.save();
    console.log(`✅ New office check-in at ${checkIn.location} (logged by ${req.user?.displayName || req.user?.username}): ${name} (${phone})`);

    // Send email alert to staff with priority fallback logic
    (async () => {
      try {
        await sendCheckInAlertEmail(checkIn);
      } catch (err) {
        console.error('❌ Check-in email dispatch exception:', err.message);
      }
    })();

    req.app.get('io').emit('checkin_update');

    res.status(201).json({
      success: true,
      message: 'Check-in successful! Welcome to Easy Stones.',
      data: checkIn
    });
  } catch (error) {
    console.error('❌ Check-in error:', error);
    res.status(500).json({ message: 'Check-in failed. Please try again.' });
  }
});

app.get('/api/checkin', authenticate, requirePermission('view_checkins'), async (req, res) => {
  try {
    const { page, limit, search, month, year, location } = req.query;

    const userLocations = req.user.assignedLocations || [];
    const query = {};

    // Apply location filtering
    if (userLocations.includes('*')) {
      if (location) {
        query.location = location;
      }
    } else {
      if (location) {
        if (userLocations.includes(location)) {
          query.location = location;
        } else {
          return res.status(403).json({ message: 'Access denied to this location' });
        }
      } else {
        query.location = { $in: userLocations };
      }
    }

    // If query parameters are not supplied, return standard raw array for backward compatibility
    if (!page && !limit && !search && !month && !year) {
      const checkIns = await OfficeCheckIn.find(query)
        .sort({ createdAt: -1 })
        .limit(50);
      return res.json(checkIns);
    }

    // Otherwise, support full pagination, search, and date filters
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    if (month && year) {
      const m = parseInt(month);
      const y = parseInt(year);
      // Month boundaries in the viewer's own zone, matching /api/checkin/stats.
      // These used to be reckoned in UTC, so a late-afternoon check-in on the last
      // day of a month was listed under the following one.
      const tz = resolveTimeZone(req.query.tz);
      query.createdAt = {
        $gte: zoneMidnightUtc(tz, y, m - 1, 1),
        $lt: zoneMidnightUtc(tz, y, m, 1)
      };
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { fabricatorCompany: searchRegex },
        { fabricatorPhone: searchRegex }
      ];
    }

    const total = await OfficeCheckIn.countDocuments(query);
    const checkIns = await OfficeCheckIn.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    res.json({
      checkIns,
      totalPages: Math.ceil(total / limitNum),
      total
    });
  } catch (error) {
    console.error('❌ Error fetching check-ins:', error);
    res.status(500).json({ message: 'Failed to fetch check-ins' });
  }
});


// Check-in stats: today count + this month count (Pacific timezone aware)
app.get('/api/checkin/stats', authenticate, requirePermission('view_checkins'), async (req, res) => {
  try {
    const now = new Date();

    // Today's and this month's start in the viewer's own zone, via the same
    // helpers the check-in list uses so both agree on which day/month a check-in
    // belongs to — and so these counts match the dates rendered on screen.
    const tz = resolveTimeZone(req.query.tz);
    const { year, monthIndex, day } = zoneDateParts(now, tz);
    const startOfToday = zoneMidnightUtc(tz, year, monthIndex, day);
    const startOfMonth = zoneMidnightUtc(tz, year, monthIndex, 1);

    const queryToday = { createdAt: { $gte: startOfToday } };
    const queryMonth = { createdAt: { $gte: startOfMonth } };
    const queryAllTime = {};
    const userLocations = req.user.assignedLocations || [];
    const { location } = req.query;

    if (userLocations.includes('*')) {
      if (location) {
        queryToday.location = location;
        queryMonth.location = location;
        queryAllTime.location = location;
      }
    } else {
      if (location) {
        if (userLocations.includes(location)) {
          queryToday.location = location;
          queryMonth.location = location;
          queryAllTime.location = location;
        } else {
          return res.status(403).json({ message: 'Access denied to this location' });
        }
      } else {
        queryToday.location = { $in: userLocations };
        queryMonth.location = { $in: userLocations };
        queryAllTime.location = { $in: userLocations };
      }
    }

    const [todayCount, monthCount, allTimeCount] = await Promise.all([
      OfficeCheckIn.countDocuments(queryToday),
      OfficeCheckIn.countDocuments(queryMonth),
      OfficeCheckIn.countDocuments(queryAllTime)
    ]);

    res.json({ todayCount, monthCount, allTimeCount });
  } catch (error) {
    console.error('❌ Error fetching check-in stats:', error);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// Get specific check-in
app.get('/api/checkin/:id', authenticate, requirePermission('view_checkins'), async (req, res) => {
  try {
    const checkIn = await OfficeCheckIn.findById(req.params.id);
    if (!checkIn) {
      return res.status(404).json({ message: 'Check-in not found' });
    }
    const userLocations = req.user.assignedLocations || [];
    if (!userLocations.includes('*') && !userLocations.includes(checkIn.location)) {
      return res.status(403).json({ message: 'Access denied to this check-in' });
    }
    res.json(checkIn);
  } catch (error) {
    console.error('❌ Error fetching check-in details:', error);
    res.status(500).json({ message: 'Failed to fetch check-in details' });
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


// Update specific check-in
// Previously unauthenticated — allowing anyone to tamper with visitor records and,
// via salesRepEmail, use the endpoint as an open relay for our email provider.
// CSRs and sales reps hold view_checkins (not manage_checkins) yet edit selections
// as part of their normal workflow, so both permissions are accepted here.
app.put('/api/checkin/:id', authenticate, requireAnyPermission('manage_checkins', 'view_checkins'), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      fabricatorCompany,
      fabricatorName,
      fabricatorPhone,
      builderName,
      builderPhone,
      selections,
      specialNotes,
      salesRep,
      salesRepEmail,
      location
    } = req.body;
    const checkIn = await OfficeCheckIn.findById(req.params.id);
    if (!checkIn) {
      return res.status(404).json({ message: 'Check-in not found' });
    }

    // Same location scoping the GET/:id and DELETE routes already enforce
    const userLocations = req.user.assignedLocations || [];
    if (!userLocations.includes('*') && !userLocations.includes(checkIn.location)) {
      return res.status(403).json({ message: 'Access denied to this check-in' });
    }

    if (name) checkIn.name = name;
    if (phone) checkIn.phone = phone;
    if (location !== undefined) checkIn.location = location;
    if (email !== undefined) checkIn.email = email;
    if (fabricatorCompany !== undefined) checkIn.fabricatorCompany = fabricatorCompany;
    if (fabricatorName !== undefined) checkIn.fabricatorName = fabricatorName;
    if (fabricatorPhone !== undefined) checkIn.fabricatorPhone = fabricatorPhone;
    if (builderName !== undefined) checkIn.builderName = builderName;
    if (builderPhone !== undefined) checkIn.builderPhone = builderPhone;
    if (selections !== undefined) {
      checkIn.selections = selections.map(sel => ({
        ...sel,
        material: sel.material ? sel.material.toUpperCase() : ''
      }));
    }
    if (specialNotes !== undefined) checkIn.specialNotes = specialNotes;
    if (salesRep !== undefined) checkIn.salesRep = salesRep;
    if (salesRepEmail !== undefined) checkIn.salesRepEmail = salesRepEmail;

    await checkIn.save();
    console.log(`✅ Office check-in updated: ${checkIn.name}`);

    // If salesRepEmail is provided, automatically trigger background email alert to sales rep
    if (salesRepEmail) {
      (async () => {
        try {
          console.log(`📡 Automatically sending selection sheet alert to sales rep: ${salesRepEmail}`);
          await sendSelectionSheetEmail(checkIn, salesRepEmail);
        } catch (err) {
          console.error('❌ Failed to auto-send selection sheet email to sales rep:', err.message);
        }
      })();
    }

    req.app.get('io').emit('checkin_update');

    res.json({ success: true, message: 'Check-in updated successfully', data: checkIn });
  } catch (error) {
    console.error('❌ Error updating check-in:', error);
    res.status(500).json({ message: 'Failed to update check-in' });
  }
});

// Send selection sheet email
app.post('/api/checkin/:id/send-email', authenticate, requirePermission('send_checkin_email'), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Recipient email is required' });
    }

    const checkIn = await OfficeCheckIn.findById(req.params.id);
    if (!checkIn) {
      return res.status(404).json({ message: 'Check-in record not found' });
    }

    const emailResult = await sendSelectionSheetEmail(checkIn, email);

    if (!emailResult.success) {
      return res.status(500).json({ message: `Failed to send selection sheet email. Details: ${emailResult.error || 'Unknown error'}` });
    }

    res.json({ success: true, message: 'Selection sheet email sent successfully' });
  } catch (error) {
    console.error('❌ Error sending selection sheet email:', error);
    res.status(500).json({ message: 'Failed to send selection sheet email' });
  }
});

// Delete specific check-in
app.delete('/api/checkin/:id', authenticate, requirePermission('delete_checkins'), async (req, res) => {
  try {
    const checkIn = await OfficeCheckIn.findById(req.params.id);
    if (!checkIn) {
      return res.status(404).json({ message: 'Check-in not found' });
    }
    const userLocations = req.user.assignedLocations || [];
    if (!userLocations.includes('*') && !userLocations.includes(checkIn.location)) {
      return res.status(403).json({ message: 'Access denied to delete this check-in' });
    }
    await OfficeCheckIn.findByIdAndDelete(req.params.id);
    console.log(`🗑️ Office check-in deleted: ${checkIn.name}`);
    req.app.get('io').emit('checkin_update');

    res.json({ success: true, message: 'Check-in deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting check-in:', error);
    res.status(500).json({ message: 'Failed to delete check-in' });
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
  } catch (error) {
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
      let buffer = req.file.buffer;

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

    const startSave = Date.now();
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
              try { fs.unlinkSync(filePath); } catch (e) { }
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
        try { fs.unlinkSync(filePath); } catch (e) { }
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
// UNIFIED CUSTOMER & LEAD MANAGEMENT // One-time merge route to move Lead metadata to Customer records
app.get('/api/unified-merge', verifyAnyAuth, async (req, res) => {
  try {
    const leads = await Lead.find({});
    let mergedCount = 0;
    let skippedCount = 0;

    for (const lead of leads) {
      // Find customer by email (most reliable) or company
      let customer = await Customer.findOne({ 
        $or: [
          { email: lead.email },
          { company: lead.company, contactName: lead.name }
        ]
      });

      if (customer) {
        // Merge metadata
        customer.status = lead.status || 'New';
        customer.customerType = lead.customerType || 'Fabricator';
        customer.level = lead.level || 'Level - 3';
        customer.modaDisplay = lead.modaDisplay || 'No';
        customer.modaBinder = lead.modaBinder || '0';
        customer.followUpDate = lead.followUpDate;
        customer.createdBy = lead.createdBy;
        if (!customer.phone) customer.phone = lead.phone;
        
        await customer.save();
        mergedCount++;
      } else {
        // If lead doesn't exist as customer, create them as a new customer
        const newCustomer = new Customer({
          contactName: lead.name || 'Unknown',
          email: lead.email || `temp_${Date.now()}@easystones.com`,
          company: lead.company,
          phone: lead.phone,
          status: lead.status || 'New',
          customerType: lead.customerType || 'Fabricator',
          level: lead.level || 'Level - 3',
          modaDisplay: lead.modaDisplay || 'No',
          modaBinder: lead.modaBinder || '0',
          followUpDate: lead.followUpDate,
          createdBy: lead.createdBy,
          isVerified: false,
          isActive: true
        });
        await newCustomer.save();
        mergedCount++;
      }
    }

    res.json({ 
      message: 'Merge completed successfully', 
      processed: leads.length,
      merged: mergedCount,
      skipped: skippedCount
    });
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({ message: 'Merge failed', error: error.message });
  }
});

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
    } else {
      sortStage.createdAt = -1; // Default fallback to newest first
    }

    const totalCount = await Customer.countDocuments(query);

    let customers;
    if (limit === -1) {
      customers = await Customer.aggregate([
        { $match: query },
        {
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
        },
        { $sort: sortStage },
        {
          $project: {
            password: 0,
            contacts: 0,
            visits: 0,
            resources: 0
          }
        }
      ]);
    } else {
      customers = await Customer.aggregate([
        { $match: query },
        {
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
        },
        { $sort: sortStage },
        {
          $project: {
            password: 0,
            contacts: 0,
            visits: 0,
            resources: 0
          }
        },
        { $skip: skip },
        { $limit: limit }
      ]);
    }

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

    const newCustomer = new Customer({
      ...req.body,
      priceLevel: priceLevel || req.body.priceLevel || 1,
      contactName: req.body.contactName || req.body.name || 'Unknown', // Map contactName/name to contactName
      marketingEmail: req.body.marketingEmail || req.body.email || '',
      receiveMarketing: req.body.receiveMarketing !== undefined ? req.body.receiveMarketing : true,
      address: {
        street: req.body.address?.street || '',
        city: req.body.address?.city || req.body.city || '',
        state: req.body.address?.state || '',
        zipCode: req.body.address?.zipCode || ''
      },
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
    
    if (req.body.address) {
      updateData.address = {
        street: req.body.address.street || '',
        city: req.body.address.city || req.body.city || '',
        state: req.body.address.state || '',
        zipCode: req.body.address.zipCode || ''
      };
    } else if (req.body.city) {
      updateData.address = {
        ...updateData.address,
        city: req.body.city
      };
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

// Delete a lead (Customer)
app.delete('/api/partners/:id', authenticate, requirePermission('manage_customers'), async (req, res) => {
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

// --- Dashboard Aggregation Helpers (Global Scope) ---

const getAggregationDateRef = (prefix) => ({
  $cond: [
    { $eq: [{ $type: `$${prefix}.date` }, "string"] },
    `$${prefix}.date`,
    {
      $cond: [
        { $eq: [{ $type: `$${prefix}.createdAt` }, "date"] },
        { $dateToString: { format: "%Y-%m-%d", date: `$${prefix}.createdAt` } },
        { $ifNull: [{ $substr: [{ $ifNull: [`$${prefix}.createdAt`, ""] }, 0, 10] }, ""] }
      ]
    }
  ]
});

const getAggregationRangeMatch = (start, end, prefix, additionalMatch = {}) => {
  const startStr = start?.toISOString().split('T')[0];
  const endStr = end?.toISOString().split('T')[0];
  const dateRef = getAggregationDateRef(prefix);
  const conds = [];

  // Add additional matches (like createdBy)
  for (const [key, value] of Object.entries(additionalMatch)) {
    // Use $toString for ID fields to be safe with mixed types
    if (key.includes('createdBy') || key.includes('uploadedBy')) {
      conds.push({ $eq: [{ $toString: `$${key}` }, value] });
    } else {
      conds.push({ $eq: [`$${key}`, value] });
    }
  }

  if (startStr) conds.push({ $gte: [dateRef, startStr] });
  if (endStr) conds.push({ $lte: [dateRef, endStr] });

  return conds.length > 0 ? { $expr: { $and: conds } } : {};
};

const getFollowUpRangeMatch = (start, end, additionalMatch = {}) => {
  const startStr = start?.toISOString().split('T')[0];
  const endStr = end?.toISOString().split('T')[0];
  const conds = [];

  // Add additional matches
  for (const [key, value] of Object.entries(additionalMatch)) {
    if (key.includes('createdBy') || key.includes('uploadedBy')) {
      conds.push({ $eq: [{ $toString: `$${key}` }, value] });
    } else {
      conds.push({ $eq: [`$${key}`, value] });
    }
  }

  // Expression to normalize followUpDate to a YYYY-MM-DD string format on the fly
  const followUpDateExpr = {
    $cond: [
      { $eq: [{ $type: "$visits.followUpDate" }, "date"] },
      { $dateToString: { format: "%Y-%m-%d", date: "$visits.followUpDate" } },
      { $ifNull: ["$visits.followUpDate", ""] }
    ]
  };

  // Include if follow-up date is set OR if follow-up notes exist
  conds.push({
    $or: [
      { $and: [{ $ne: [followUpDateExpr, ""] }, { $ne: [followUpDateExpr, null] }] },
      { $and: [{ $ne: ["$visits.followUp", ""] }, { $ne: ["$visits.followUp", null] }] },
      { $and: [{ $ne: ["$visits.nextAction", ""] }, { $ne: ["$visits.nextAction", null] }] }
    ]
  });

  // Optimised Follow-up Logic:
  // 1. If a range is provided, we filter based on followUpDate.
  if (startStr) {
    if (startStr === endStr) {
      // "Today" (or single day) filter on dashboard: show follow-ups for that day OR anytime in the future
      // This excludes past/overdue follow-ups to keep the "Today" view focused on current/upcoming work.
      conds.push({
        $and: [
          { $ne: [followUpDateExpr, ""] },
          { $ne: [followUpDateExpr, null] },
          { $gte: [followUpDateExpr, startStr] }
        ]
      });
    } else {
      // Other ranges (7 days, 30 days, or "All"): Show items in range PLUS overdue items.
      const todayStr = new Date().toISOString().split('T')[0];
      const referenceToday = (startStr < todayStr) ? todayStr : startStr;

      conds.push({
        $or: [
          { $gte: [followUpDateExpr, startStr] },
          { $lt: [followUpDateExpr, referenceToday] },
          // Items without a date (notes only) are included in the "All" or relative views
          { $eq: [followUpDateExpr, ""] },
          { $eq: [followUpDateExpr, null] }
        ]
      });
    }
  }

  return { $expr: { $and: conds } };
};

// For face-value date range comparisons (legacy helper, keeping for compatibility if needed)
const getFaceValueRangeMatch = (start, end) => {
  if (!start) return {};
  const range = { $gte: start.toISOString().split('T')[0] };
  if (end) range.$lte = end.toISOString().split('T')[0];
  return range;
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

    const result = await Customer.updateOne(
      { _id: customerId, 'visits._id': visitId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or visit not found' });
    }

    res.json({ success: true, message: 'Visit updated successfully' });

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
app.delete('/api/customers/:customerId/visits/:visitId', authenticate, requirePermission('manage_customers'), async (req, res) => {
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

// ============================================
// SCHEDULE / PLANNER ENDPOINTS
// ============================================

// Get user's schedule
app.get('/api/schedule', verifyAnyAuth, async (req, res) => {

  try {
    const userId = req.userId || req.customerId;
    const { start, end } = req.query;

    let query = { userId };

    if (start && end) {
      query.startTime = { $gte: start, $lte: end };
    }

    const schedule = await Schedule.find(query)
      .populate('customerId', 'contactName company')
      .sort({ startTime: 1 });

    res.json(schedule);
  } catch (error) {
    console.error('Fetch schedule error:', error);
    res.status(500).json({ message: 'Failed to fetch schedule' });
  }
});

// Create schedule item
app.post('/api/schedule', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const { customerId, startTime, endTime, activityType, notes } = req.body;

    if (!customerId || !startTime) {
      return res.status(400).json({ message: 'Missing required schedule fields' });
    }

    const newItem = new Schedule({
      userId,
      customerId,
      startTime,
      endTime,
      activityType,
      notes
    });

    await newItem.save();

    // Populate customer info for the response
    const populatedItem = await Schedule.findById(newItem._id).populate('customerId', 'contactName company');

    res.status(201).json(populatedItem);
  } catch (error) {
    console.error('Create schedule error:', error);
    res.status(500).json({ message: 'Failed to create schedule entry' });
  }
});

// Update schedule item
app.put('/api/schedule/:id', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const { id } = req.params;
    const updates = req.body;

    const item = await Schedule.findOneAndUpdate(
      { _id: id, userId },
      updates,
      { new: true }
    ).populate('customerId', 'contactName company');

    if (!item) {
      return res.status(404).json({ message: 'Schedule item not found' });
    }

    res.json(item);
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(500).json({ message: 'Failed to update schedule entry' });
  }
});

// Delete schedule item
app.delete('/api/schedule/:id', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const { id } = req.params;

    const result = await Schedule.deleteOne({ _id: id, userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Schedule item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete schedule error:', error);
    res.status(500).json({ message: 'Failed to delete schedule entry' });
  }
});

// ── MANIFEST DISPATCH SCHEDULER ENDPOINTS (MongoDB Persisted) ──

// ── Delivery schedule authorisation ──────────────────────────────────────────
// These routes previously used verifyAnyAuth alone, which admits *customer*
// tokens (authenticate assigns them permissions: []) — meaning any logged-in
// customer could read and modify the whole dispatch board.
//
// Guard levels are chosen against the live role config, not the seed defaults:
//   view_delivery_schedule   — held by all six staff roles
//   edit_delivery_schedule   — all staff EXCEPT driver
//   delete_delivery_schedule — admin / director / manager only
//
// Drivers legitimately POST (ePOD capture + status updates) despite lacking
// edit_delivery_schedule, so writes accept view_delivery_schedule as well.
//
// Deletion is the exception: it requires delete_delivery_schedule outright, so
// who can remove a delivery is controlled purely by role config in
// Users & Roles → Delivery Schedule → Delete.
const canViewDeliveries = requirePermission('view_delivery_schedule');
const canWriteDeliveries = requireAnyPermission('edit_delivery_schedule', 'view_delivery_schedule');
const canDeleteDeliveries = requirePermission('delete_delivery_schedule');
// Deliberately separate from deletion: a dispatcher who should never remove a
// job may still need to void a proof the wrong customer signed, and the reverse
// holds too.
const canClearPod = requirePermission('clear_pod_signatures');

app.get('/api/trucks', verifyAnyAuth, canViewDeliveries, async (req, res) => {
  try {
    const trucks = await Truck.find().lean();
    res.json(trucks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trucks' });
  }
});

app.post('/api/trucks', verifyAnyAuth, requirePermission('edit_delivery_schedule'), async (req, res) => {
  try {
    const { trucks } = req.body;
    if (Array.isArray(trucks)) {
      for (const t of trucks) {
        if (t.id) {
          await Truck.findOneAndUpdate({ id: t.id }, { $set: t }, { upsert: true });
        }
      }
    }
    const updated = await Truck.find().lean();
    req.app.get('io')?.emit('truck_update', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save trucks' });
  }
});

// Board/list views never need the raw embedded POD images (base64 signatures/photos
// can be 100s of KB each) — excluding them keeps list fetches and socket broadcasts
// fast regardless of network conditions. Full POD data is fetched on-demand via
// GET /api/deliveries/:id when a specific delivery's POD is actually opened.
const DELIVERY_LIST_PROJECTION = {
  'pod.customerSignature': 0,
  'pod.driverSignature': 0,
  'pod.photos': 0
};

// Restrict a delivery query to the branches a user is assigned to.
//
// Deliveries whose location is unset stay visible to everyone, which is the rule
// the board applied client-side and the only safe one today: every existing
// delivery has location: '' because nothing populates the field yet. Scoping
// strictly would empty the board for all users. Once deliveries start carrying a
// location, this filter narrows them automatically.
// ── DAILY WORK REPORT ──
// Lives in src/routes/dailyReports.js rather than here — a self-contained
// feature with its own model, handed the middleware it needs.
app.use('/api/daily-reports', createDailyReportsRouter({
  authenticate,
  requirePermission
}));

const scopeDeliveryQueryToLocations = (query, req) => {
  const userLocations = req.user?.assignedLocations || [];
  if (userLocations.includes('*')) return query;
  return {
    ...query,
    $or: [
      { location: { $in: [...userLocations, '', '*'] } },
      { location: { $exists: false } },
      { location: null }
    ]
  };
};

app.get('/api/deliveries', verifyAnyAuth, canViewDeliveries, async (req, res) => {
  try {
    // The board only ever displays one week at a time — scope the query to that
    // range (via ?startDate=&endDate=, both 'YYYY-MM-DD') instead of pulling the
    // entire, ever-growing delivery history on every load. Falls back to the full
    // collection if no range is given.
    // An order with no driver assigned is Pending: it is waiting on the customer
    // for a date and a driver, and belongs to no truck column. ?pending=true
    // returns those; a week request returns the assigned ones only, so nothing
    // is stranded between the two views.
    // A will call is not pending, though it never gets a driver: the customer
    // collects it on a known date, so it belongs to its week under the board's
    // Will Call column. Both queries account for it so it lands in exactly one.
    const { startDate, endDate, pending } = req.query;
    let baseQuery;
    if (pending === 'true') {
      // $in rather than $or: the location scoping below contributes its own $or,
      // and a second one on the same object would replace this filter outright.
      // { $in: ['', null] } also matches documents with no truckId field at all.
      baseQuery = { truckId: { $in: ['', null] }, deliveryType: { $ne: 'will_call' } };
    } else if (startDate && endDate) {
      // Wrapped in $and for the same reason: the location scoping owns the
      // top-level $or, so this one has to live where it cannot be overwritten.
      baseQuery = {
        date: { $gte: startDate, $lte: endDate },
        $and: [{ $or: [{ truckId: { $nin: ['', null] } }, { deliveryType: 'will_call' }] }]
      };
    } else {
      baseQuery = {};
    }
    const query = scopeDeliveryQueryToLocations(baseQuery, req);
    const list = await Delivery.find(query, DELIVERY_LIST_PROJECTION).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('[server] get deliveries error:', err);
    res.status(500).json({ error: 'Server error fetching deliveries' });
  }
});

app.get('/api/deliveries/:id', verifyAnyAuth, canViewDeliveries, async (req, res) => {
  try {
    const { id } = req.params;
    const delivery = await Delivery.findOne(scopeDeliveryQueryToLocations({ id }, req)).lean();
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    res.json(delivery);
  } catch (err) {
    console.error('[server] get delivery by id error:', err);
    res.status(500).json({ error: 'Server error fetching delivery' });
  }
});

app.post('/api/deliveries', verifyAnyAuth, canWriteDeliveries, async (req, res) => {
  try {
    const delivery = req.body;
    if (!delivery || !delivery.id) return res.status(400).json({ error: 'Invalid delivery data' });

    const updateData = { ...delivery };
    delete updateData._id;

    const assetIds = podAssetIds(delivery.id);

    // ePOD validity is a server conclusion, never a client claim — drop whatever
    // the browser sent and recompute it from the record further down.
    if (updateData.pod) delete updateData.pod.verified;

    // A packing list arriving inline as base64 becomes a stored PDF. Previously
    // this wrote to public/uploads, which Render wipes on every deploy — the
    // saved URL outlived the file it pointed at.
    if (updateData.packingListUrl && updateData.packingListUrl.toLowerCase().startsWith('data:application/pdf')) {
      try {
        const base64Parts = updateData.packingListUrl.split(',');
        const base64Data = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
        const buffer = Buffer.from(base64Data, 'base64');
        const stored = await storeDeliveryPdf(
          buffer,
          assetIds.packingList,
          `packing_list_${safeIdSegment(delivery.id)}.pdf`
        );
        updateData.packingListUrl = stored.url;
        updateData.packingListPublicId = stored.publicId;
        if (!updateData.packingListFilename) {
          updateData.packingListFilename = 'PackingList.pdf';
        }
        console.log(`📄 Stored packing list for ${delivery.id}: ${stored.url}`);
      } catch (convErr) {
        console.error('Error storing base64 packing list:', convErr);
      }
    }

    if (updateData.pod) {
      const existing = await Delivery.findOne(
        { id: delivery.id },
        'pod packingListUrl'
      ).lean();

      updateData.pod = mergePodOntoExisting(updateData.pod, existing?.pod || {});

      // The signature pads send data URLs. Stamp the certificate before those
      // get swapped for hosted URLs, since pdf-lib embeds from the raw bytes.
      const freshCustSig = String(updateData.pod.customerSignature || '').startsWith('data:image/');
      const freshDriverSig = String(updateData.pod.driverSignature || '').startsWith('data:image/');

      const sourcePdf = updateData.packingListUrl || existing?.packingListUrl || '';

      // Stamping runs here rather than on the driver's phone: the device uploads
      // ~30KB of signature PNGs instead of pulling down a multi-MB packing list
      // and pushing the whole signed copy back over cellular.
      if (freshCustSig && freshDriverSig && sourcePdf) {
        try {
          const signedBytes = await stampSignaturesOnPdfBytes({
            pdfUrl: sourcePdf,
            customerSignatureDataUrl: updateData.pod.customerSignature,
            driverSignatureDataUrl: updateData.pod.driverSignature,
            signeeName: updateData.pod.signeeName || '',
            driverName: updateData.pod.driverName || '',
            signedAt: updateData.pod.signedAt || new Date(),
            customerSignedAt: updateData.pod.customerSignedAt,
            driverSignedAt: updateData.pod.driverSignedAt
          });

          // Named after the packing list number — "145994_signed.pdf" — so the
          // signed copy files next to the paperwork it was stamped from.
          const signedName = signedPackingListFileName({
            packingListFilename: updateData.packingListFilename || delivery.packingListFilename,
            soNumber: delivery.soNumber,
            invoiceNumber: delivery.invoiceNumber,
            id: delivery.id
          });

          const stored = await storeDeliveryPdf(
            Buffer.from(signedBytes),
            assetIds.signedPdf,
            signedName
          );
          updateData.pod.signedPdfUrl = stored.url;
          updateData.pod.signedPdfPublicId = stored.publicId;
          updateData.pod.signedPdfFilename = signedName;
        } catch (stampErr) {
          // Drop any previously stamped copy: these are new signatures, and a
          // fresh proof must never point at the document the last one produced.
          // pod.verified then stays false rather than claiming a delivery is
          // proven against a PDF that doesn't match it.
          updateData.pod.signedPdfUrl = '';
          updateData.pod.signedPdfPublicId = '';
          updateData.pod.signedPdfFilename = '';
          console.error(`[pod] stamping failed for ${delivery.id}:`, stampErr);
        }
      }

      // Signatures and photos move to Cloudinary so the delivery document stays
      // small — inline base64 used to bloat list queries and socket broadcasts.
      try {
        updateData.pod.customerSignature =
          await storeSignaturePng(updateData.pod.customerSignature, assetIds.custSig);
        updateData.pod.driverSignature =
          await storeSignaturePng(updateData.pod.driverSignature, assetIds.driverSig);

        if (Array.isArray(updateData.pod.photos) && updateData.pod.photos.length > 0) {
          updateData.pod.photos = await processBase64Images(updateData.pod.photos, 'deliveries/pod');
        }
      } catch (podErr) {
        console.error('Error uploading POD images to Cloudinary:', podErr);
      }

      updateData.pod.verified = derivePodVerified(updateData.pod, Boolean(sourcePdf));

      // A fresh signature ends the "awaiting re-sign" state left by a clear.
      if (updateData.pod.verified) {
        updateData.pod.clearedAt = null;
        updateData.pod.clearedBy = '';
        updateData.pod.clearReason = '';
      }
    }

    const updated = await Delivery.findOneAndUpdate(
      { id: delivery.id },
      { $set: updateData },
      { upsert: true, new: true }
    ).lean();

    // Broadcast just the single changed record — not the whole collection. Clients
    // merge it into whichever cached week(s) it belongs to.
    try {
      io.emit('delivery_update', { type: 'upsert', delivery: updated });
    } catch (e) {
      req.app.get('io')?.emit('delivery_update', { type: 'upsert', delivery: updated });
    }
    res.json(updated);
  } catch (err) {
    console.error('[server] save delivery error:', err);
    res.status(500).json({ error: 'Server error saving delivery' });
  }
});

app.delete('/api/deliveries/:id', verifyAnyAuth, canDeleteDeliveries, async (req, res) => {
  try {
    const { id } = req.params;
    await Delivery.deleteOne({ id });
    try {
      io.emit('delivery_update', { type: 'delete', id });
    } catch (e) {
      req.app.get('io')?.emit('delivery_update', { type: 'delete', id });
    }
    res.json({ success: true, id });
  } catch (err) {
    console.error('[server] delete delivery error:', err);
    res.status(500).json({ error: 'Server error deleting delivery' });
  }
});

// Void the ePOD on a delivery so a new signature can be captured — the wrong
// person signing at a shared jobsite is the case this exists for.
//
// The delivery stays 'completed': the material did arrive, and dropping it back
// to 'scheduled' would put a phantom job on the board. Only the proof is
// withdrawn, and the original packing list is deliberately left in place so the
// re-sign starts from a clean copy.
app.delete('/api/deliveries/:id/pod', verifyAnyAuth, canClearPod, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 4) {
      return res.status(400).json({ error: 'A reason is required to clear an ePOD.' });
    }

    const delivery = await Delivery.findOne(scopeDeliveryQueryToLocations({ id }, req));
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

    const { id: performedBy, name: performedByName } = await getPerformerInfo(req);
    const assetIds = podAssetIds(id);
    const previous = delivery.pod || {};

    // Destroy by stored id where we have one, falling back to the derived id for
    // records written before publicIds were tracked.
    await Promise.all([
      destroyCloudinaryAsset(previous.signedPdfPublicId || assetIds.signedPdf, 'raw'),
      destroyCloudinaryAsset(assetIds.custSig, 'image'),
      destroyCloudinaryAsset(assetIds.driverSig, 'image')
    ]);

    delivery.pod = {
      signeeName: '',
      driverName: '',
      customerSignature: '',
      driverSignature: '',
      customerSignedAt: null,
      driverSignedAt: null,
      signedAt: null,
      photos: previous.photos || [],
      notes: previous.notes || '',
      signedPdfUrl: '',
      signedPdfFilename: '',
      signedPdfPublicId: '',
      verified: false,
      clearedAt: new Date(),
      clearedBy: performedByName,
      clearReason: reason
    };
    await delivery.save();

    try {
      await ActivityLog.create({
        entityType: 'Delivery',
        entityId: delivery._id,
        action: 'DELETE',
        performedBy,
        performedByName,
        performedByRole: req.authType,
        timestamp: getNowLocalISO(),
        details: {
          scope: 'epod',
          deliveryId: id,
          soNumber: delivery.soNumber || '',
          customerName: delivery.customerName || '',
          reason,
          previousSignee: previous.signeeName || '',
          previousSignedAt: previous.signedAt || null
        }
      });
    } catch (logErr) {
      console.error('Failed to log ePOD clear:', logErr);
    }

    const updated = delivery.toObject();
    try {
      io.emit('delivery_update', { type: 'upsert', delivery: updated });
    } catch (e) {
      req.app.get('io')?.emit('delivery_update', { type: 'upsert', delivery: updated });
    }

    res.json({ success: true, delivery: updated });
  } catch (err) {
    console.error('[server] clear ePOD error:', err);
    res.status(500).json({ error: 'Server error clearing ePOD' });
  }
});

// PDF Upload Endpoint for Delivery Packing Lists.
//
// Memory storage, not disk: Render's filesystem is ephemeral, so the previous
// diskStorage write produced a packingListUrl that broke on the next deploy.
const uploadPackingList = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/api/deliveries/upload-packing-list', verifyAnyAuth, canWriteDeliveries, uploadPackingList.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    // Keyed on the delivery when the caller names one, so re-uploading a
    // corrected packing list replaces the old asset instead of orphaning it.
    const deliveryId = req.body?.deliveryId;
    const key = deliveryId
      ? podAssetIds(deliveryId).packingList
      : `deliveries/packing_lists/tmp_${Date.now()}_${Math.round(Math.random() * 1e4)}`;

    const stored = await storeDeliveryPdf(
      req.file.buffer,
      key,
      `packing_list_${safeIdSegment(deliveryId || Date.now())}.pdf`
    );

    res.json({
      success: true,
      url: stored.url,
      publicId: stored.publicId,
      filename: req.file.originalname
    });
  } catch (err) {
    console.error('Error uploading packing list PDF:', err);
    res.status(500).json({ error: 'Failed to upload packing list PDF' });
  }
});

// Private, read-only calendar feed in iCalendar (.ics) format
app.get('/api/calendar/feed/:userId.ics', async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send('Invalid user ID');
    }

    // Find all scheduled activities for this user (exclude cancelled ones)
    const schedules = await Schedule.find({
      userId,
      status: { $ne: 'Cancelled' }
    })
      .populate('customerId', 'contactName company')
      .lean();

    // Helper to format Date objects / strings to iCal date format (YYYYMMDDTHHmmssZ)
    const formatIcsDate = (dateVal) => {
      if (!dateVal) return '';
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '';
      
      const pad = (n) => String(n).padStart(2, '0');
      const year = d.getUTCFullYear();
      const month = pad(d.getUTCMonth() + 1);
      const day = pad(d.getUTCDate());
      const hours = pad(d.getUTCHours());
      const minutes = pad(d.getUTCMinutes());
      const seconds = pad(d.getUTCSeconds());
      
      return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
    };

    // Build iCalendar string
    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EasyStones//CalendarFeed//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Easy Stones Schedule',
      'X-WR-TIMEZONE:UTC',
      'X-WR-CALDESC:Meetings, calls, and visits scheduled in Easy Stones website.'
    ];

    schedules.forEach((item) => {
      const clientName = item.customerId 
        ? (item.customerId.company || item.customerId.contactName || 'Unnamed Customer') 
        : 'Unknown Customer';
      
      const startStr = formatIcsDate(item.startTime);
      // Default to 1 hour meeting if endTime is not set or invalid
      let endStr = formatIcsDate(item.endTime);
      if (!endStr && item.startTime) {
        const startDateObj = new Date(item.startTime);
        startDateObj.setHours(startDateObj.getHours() + 1);
        endStr = formatIcsDate(startDateObj);
      }

      const uid = `${item._id}@easystones.com`;
      const createdStr = formatIcsDate(item.createdAt || new Date());
      const modifiedStr = formatIcsDate(item.updatedAt || new Date());

      // Clean text fields of newlines and commas for ICS spec
      const cleanText = (str) => {
        if (!str) return '';
        return str.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
      };

      const summary = cleanText(`${item.activityType || 'Visit'} - ${clientName}`);
      const notes = cleanText(item.notes || '');

      icsContent.push('BEGIN:VEVENT');
      icsContent.push(`UID:${uid}`);
      icsContent.push(`DTSTAMP:${createdStr}`);
      icsContent.push(`LAST-MODIFIED:${modifiedStr}`);
      if (startStr) icsContent.push(`DTSTART:${startStr}`);
      if (endStr) icsContent.push(`DTEND:${endStr}`);
      icsContent.push(`SUMMARY:${summary}`);
      if (notes) icsContent.push(`DESCRIPTION:${notes}`);
      icsContent.push('STATUS:CONFIRMED');
      icsContent.push('END:VEVENT');
    });

    icsContent.push('END:VCALENDAR');

    // Join with CRLF lines according to iCal specifications
    const responseText = icsContent.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(responseText);
  } catch (error) {
    console.error('Error generating calendar feed:', error);
    res.status(500).send('Error generating calendar feed');
  }
});

// Helper to determine the standard OAuth callback redirect URI
const getRedirectUri = (req) => {
  const host = req.get('host');
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  const protocol = isLocal ? 'http' : 'https';
  return `${protocol}://${host}/api/auth/google/calendar/callback`;
};

// Helper: Refresh expired Google Access Token using the user's Refresh Token
const refreshGoogleAccessToken = async (user) => {
  if (!user.googleRefreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: user.googleRefreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Token refresh failed for user ${user.username}:`, errText);
    throw new Error('Failed to refresh Google access token');
  }

  const data = await response.json();
  user.googleAccessToken = data.access_token;
  await user.save();
  return data.access_token;
};

// Core Helper: Perform Two-Way synchronization between MongoDB Schedules and Google Calendar
const syncGoogleCalendar = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.googleCalendarSyncEnabled || !user.googleAccessToken) {
      return;
    }

    let accessToken = user.googleAccessToken;

    const fetchGoogleEvents = async (token) => {
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - 30);
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 90);

      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        `timeMin=${encodeURIComponent(timeMin.toISOString())}` +
        `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
        `&singleEvents=true`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 401) {
        const newToken = await refreshGoogleAccessToken(user);
        return fetchGoogleEvents(newToken);
      }

      if (!res.ok) {
        throw new Error(`Google Calendar API error: ${res.statusText}`);
      }

      return res.json();
    };

    const data = await fetchGoogleEvents(accessToken);
    const googleEvents = data.items || [];

    // 1. Google -> Sales Planner Sync
    for (const gEvent of googleEvents) {
      const isSyncedFromApp = gEvent.description && gEvent.description.includes('EasyStones ID:');
      if (isSyncedFromApp) {
        continue;
      }

      const existingImport = await Schedule.findOne({
        userId,
        notes: new RegExp(`Google ID: ${gEvent.id}`)
      });

      if (gEvent.status === 'cancelled') {
        if (existingImport) {
          await Schedule.deleteOne({ _id: existingImport._id });
        }
        continue;
      }

      const startTime = gEvent.start.dateTime || gEvent.start.date;
      const endTime = gEvent.end.dateTime || gEvent.end.date;

      if (!startTime) continue;

      if (existingImport) {
        existingImport.startTime = startTime;
        existingImport.endTime = endTime;
        existingImport.notes = `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`;
        await existingImport.save();
      } else {
        let syncCustomer = await Customer.findOne({ company: 'Google Calendar Sync' });
        if (!syncCustomer) {
          syncCustomer = new Customer({
            company: 'Google Calendar Sync',
            contactName: 'Google Event Sync',
            phone: '000-000-0000',
            email: 'sync@easystones.com',
            status: 'Lead'
          });
          await syncCustomer.save();
        }

        const newItem = new Schedule({
          userId,
          customerId: syncCustomer._id,
          startTime,
          endTime,
          activityType: 'Other',
          notes: `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`,
          status: 'Scheduled'
        });
        await newItem.save();
      }
    }

    // 2. Sales Planner -> Google Sync
    const appSchedules = await Schedule.find({
      userId,
      notes: { $not: /Google ID:/ },
      status: { $ne: 'Cancelled' }
    }).populate('customerId', 'contactName company');

    for (const schedule of appSchedules) {
      const syncedMatch = schedule.notes && schedule.notes.match(/Synced to Google ID: ([a-zA-Z0-9_]+)/);
      const clientName = schedule.customerId 
        ? (schedule.customerId.company || schedule.customerId.contactName || 'Unnamed Customer') 
        : 'Unknown Customer';
      
      const eventPayload = {
        summary: `${schedule.activityType || 'Visit'} - ${clientName}`,
        description: `${schedule.notes || ''}\n\n[EasyStones ID: ${schedule._id}]`,
        start: { dateTime: new Date(schedule.startTime).toISOString() },
        end: { dateTime: new Date(schedule.endTime || new Date(schedule.startTime).getTime() + 3600000).toISOString() }
      };

      if (syncedMatch) {
        const googleEventId = syncedMatch[1];
        const updateUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventPayload)
        });
      } else {
        const createUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
        const createRes = await fetch(createUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventPayload)
        });

        if (createRes.ok) {
          const createdEvent = await createRes.json();
          schedule.notes = `${schedule.notes || ''}\n\n[Synced to Google ID: ${createdEvent.id}]`;
          await schedule.save();
        }
      }
    }
  } catch (err) {
    console.error(`Error in syncGoogleCalendar for user ${userId}:`, err);
  }
};

// Route: Initiate Google OAuth Redirection for Calendar Sync
app.get('/api/auth/google/calendar', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(401).send('Authentication token is required');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).send('Invalid or expired authentication token');
    }

    const userId = decoded.id;
    if (!userId) {
      return res.status(401).send('Invalid token payload');
    }

    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;

    if (!client_id || !client_secret) {
      return res.status(400).send('Google Client credentials are not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables.');
    }

    const redirect_uri = getRedirectUri(req);
    const scope = 'https://www.googleapis.com/auth/calendar';
    const state = token;

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authUrl);
  } catch (error) {
    console.error('Google calendar auth redirect error:', error);
    res.status(500).send('Error initiating Google Calendar authorization');
  }
});

// Route: Google OAuth Redirect callback to parse code and save user tokens
app.get('/api/auth/google/calendar/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('Google OAuth callback error:', error);
      return res.redirect('/sales?error=google_auth_failed');
    }

    if (!code || !state) {
      return res.status(400).send('Missing authorization code or state');
    }

    let decoded;
    try {
      decoded = jwt.verify(state, JWT_SECRET);
    } catch (err) {
      return res.status(401).send('Invalid or expired state token');
    }

    const userId = decoded.id;
    if (!userId) {
      return res.status(401).send('Invalid state payload');
    }

    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    const redirect_uri = getRedirectUri(req);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id,
        client_secret,
        redirect_uri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('Google token exchange failed:', errText);
      return res.status(500).send('Failed to exchange authorization code for tokens');
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token } = tokens;

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    let googleEmail = null;
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      googleEmail = profile.email;
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send('User not found');
    }

    user.googleAccessToken = access_token;
    if (refresh_token) {
      user.googleRefreshToken = refresh_token;
    }
    user.googleEmail = googleEmail;
    user.googleCalendarSyncEnabled = true;
    await user.save();

    console.log(`✅ Google Calendar linked for user: ${user.username} (${googleEmail})`);

    // Redirect to sales page with confirmation
    res.redirect('/sales?google_sync=success');
  } catch (error) {
    console.error('Google calendar OAuth callback error:', error);
    res.status(500).send('Error completing Google Calendar integration');
  }
});

// Route: Get current user's Google Calendar integration status
app.get('/api/auth/google/calendar/status', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const user = await User.findById(userId).select('googleEmail googleCalendarSyncEnabled').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      connected: !!user.googleEmail && user.googleCalendarSyncEnabled,
      email: user.googleEmail
    });
  } catch (error) {
    console.error('Google calendar status error:', error);
    res.status(500).json({ message: 'Failed to fetch status' });
  }
});

// Route: Trigger manual synchronization cycle
app.post('/api/auth/google/calendar/sync', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    await syncGoogleCalendar(userId);
    res.json({ success: true, message: 'Google Calendar synchronized successfully' });
  } catch (error) {
    console.error('Google calendar sync trigger error:', error);
    res.status(500).json({ message: 'Failed to synchronize Google Calendar' });
  }
});

// Route: Disconnect calendar integration
app.post('/api/auth/google/calendar/disconnect', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.googleAccessToken = null;
    user.googleRefreshToken = null;
    user.googleEmail = null;
    user.googleCalendarSyncEnabled = false;
    await user.save();

    res.json({ success: true, message: 'Google Calendar disconnected successfully' });
  } catch (error) {
    console.error('Google calendar disconnect error:', error);
    res.status(500).json({ message: 'Failed to disconnect Google Calendar' });
  }
});

// Route: Connect Apple iCloud Calendar (Discover or Save)
app.post('/api/auth/icloud/connect', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const { appleId, appSpecificPassword, calendarUrl, calendarName } = req.body;

    if (!appleId || !appSpecificPassword) {
      return res.status(400).json({ message: 'Apple ID and App-Specific Password are required' });
    }

    if (!calendarUrl) {
      // Step 1: Discover available calendars
      const calendars = await discoverICloudCalendars(appleId, appSpecificPassword);
      return res.json({ success: true, calendars });
    } else {
      // Step 2: Save the user's selected calendar url & name
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      user.icloudUsername = appleId;
      user.icloudPassword = appSpecificPassword;
      user.icloudCalendarUrl = calendarUrl;
      user.icloudCalendarName = calendarName || 'Primary Calendar';
      user.icloudSyncEnabled = true;
      await user.save();

      // Trigger initial sync cycle
      await syncICloudCalendar(userId);

      return res.json({
        success: true,
        message: 'iCloud Calendar connected successfully',
        calendarName: user.icloudCalendarName
      });
    }
  } catch (error) {
    console.error('iCloud calendar connection error:', error);
    res.status(500).json({ message: error.message || 'Failed to connect to iCloud' });
  }
});

// Route: Get iCloud Sync status
app.get('/api/auth/icloud/status', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const user = await User.findById(userId).select('icloudUsername icloudCalendarName icloudSyncEnabled').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      connected: !!user.icloudUsername && user.icloudSyncEnabled,
      email: user.icloudUsername,
      calendarName: user.icloudCalendarName
    });
  } catch (error) {
    console.error('iCloud status error:', error);
    res.status(500).json({ message: 'Failed to fetch iCloud status' });
  }
});

// Route: Trigger manual iCloud Sync
app.post('/api/auth/icloud/sync', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    await syncICloudCalendar(userId);
    res.json({ success: true, message: 'iCloud Calendar synchronized successfully' });
  } catch (error) {
    console.error('iCloud sync trigger error:', error);
    res.status(500).json({ message: 'Failed to synchronize iCloud Calendar' });
  }
});

// Route: Disconnect iCloud Sync
app.post('/api/auth/icloud/disconnect', verifyAnyAuth, async (req, res) => {
  try {
    const userId = req.userId || req.customerId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.icloudUsername = null;
    user.icloudPassword = null;
    user.icloudCalendarUrl = null;
    user.icloudCalendarName = null;
    user.icloudSyncEnabled = false;
    await user.save();

    res.json({ success: true, message: 'iCloud Calendar disconnected successfully' });
  } catch (error) {
    console.error('iCloud disconnect error:', error);
    res.status(500).json({ message: 'Failed to disconnect iCloud Calendar' });
  }
});

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
      }
    }

    res.json({ success: true, message: 'Resource updated successfully' });
  } catch (error) {
    console.error('Update resource error:', error);
    res.status(500).json({ message: 'Failed to update resource' });
  }
});

// Delete resource
app.delete('/api/customers/:customerId/resources/:resourceId', authenticate, requirePermission('manage_customers'), async (req, res) => {
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
    if (titleToMatch && customer.visits && customer.visits.length > 0) {
      const matchingVisitIndex = customer.visits.findIndex(v => 
        v.purpose && (
          v.purpose.includes(titleToMatch) || 
          (resource.resourceType && v.purpose.includes(resource.resourceType))
        )
      );
      if (matchingVisitIndex > -1) {
        customer.visits.splice(matchingVisitIndex, 1);
      }
    }

    await customer.save();

    res.json({ success: true, message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({ message: 'Failed to delete resource' });
  }
});

// Admin: Get all customers

// Bulk upload customers
app.post('/api/admin/customers/bulk-upload', verifyToken, uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const workbook = read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Read with headers (default behavior of sheet_to_json)
    // This gives us an array of objects where keys are the column headers
    const data = utils.sheet_to_json(sheet);

    if (!data || data.length === 0) {
      return res.status(400).json({ message: 'Sheet is empty or could not be parsed' });
    }

    // Heuristic matching to find correct columns regardless of exact name
    // We look at the keys of the first row to determine mappings
    const firstRow = data[0]; // Use first data row keys as schema
    const keys = Object.keys(firstRow);

    const findKey = (keywords) => {
      return keys.find(k => keywords.some(w => k.toLowerCase().includes(w)));
    };

    // Attempt to identify columns based on likely keywords
    const emailKey = findKey(['email', 'e-mail', 'mail']);
    const nameKey = findKey(['contact', 'name', 'customer', 'full name']);
    const companyKey = findKey(['company', 'business', 'organization', 'firm']);
    const phoneKey = findKey(['phone', 'mobile', 'cell', 'tel']);

    // Address components
    const addressKey = findKey(['address', 'street', 'location']);
    const cityKey = findKey(['city', 'town']);
    const stateKey = findKey(['state', 'province', 'region']);
    const zipKey = findKey(['zip', 'postal', 'code']);

    // CRM Lead & Display fields
    const levelKey = findKey(['level', 'tier', 'grade']);
    const typeKey = findKey(['customertype', 'customer type', 'type', 'category']);
    const statusKey = findKey(['status', 'stage', 'lead status']);
    const modaDisplayKey = findKey(['modadisplay', 'moda display', 'display']);
    const modaBinderKey = findKey(['modabinder', 'moda binder', 'binder']);

    console.log('Bulk Upload - Detected Column Mapping:', {
      email: emailKey,
      name: nameKey,
      company: companyKey,
      phone: phoneKey,
      level: levelKey,
      customerType: typeKey,
      status: statusKey,
      modaDisplay: modaDisplayKey,
      modaBinder: modaBinderKey
    });

    const results = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    // Helper to normalize strings (lowercase & strip non-alphanumeric characters like spaces/punctuation)
    const normalizeStr = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    };

    // Helper to map level string (defaults to Level - 4 for Excel upload)
    const parseLevel = (val) => {
      if (!val) return { levelStr: 'Level - 4', priceNum: 4 };
      const s = String(val).trim().toLowerCase();
      if (s.includes('1')) return { levelStr: 'Level - 1', priceNum: 1 };
      if (s.includes('2')) return { levelStr: 'Level - 2', priceNum: 2 };
      if (s.includes('3')) return { levelStr: 'Level - 3', priceNum: 3 };
      if (s.includes('4')) return { levelStr: 'Level - 4', priceNum: 4 };
      return { levelStr: 'Level - 4', priceNum: 4 };
    };

    // Helper to map Customer Type
    const parseType = (val) => {
      if (!val) return 'Fabricator';
      const s = String(val).trim().toLowerCase();
      if (s.includes('contractor')) return 'Contractor';
      if (s.includes('dealer')) return 'Dealer';
      if (s.includes('floor')) return 'Floor Covering';
      if (s.includes('designer')) return 'Designer';
      if (s.includes('builder')) return 'Builder';
      if (s.includes('fabricator')) return 'Fabricator';
      return String(val).trim();
    };

    // Helper to map Status
    const parseStatus = (val) => {
      if (!val) return 'Onboarded';
      const s = String(val).trim().toLowerCase();
      if (s.includes('new') || s.includes('lead')) return 'New Lead';
      if (s.includes('try') || s.includes('onboard')) return 'Trying to Onboard';
      if (s.includes('contact') || s.includes('discuss')) return 'Contacted / In Discussion';
      if (s.includes('different') || s.includes('rep')) return 'Different Sales Person';
      if (s.includes('not interested')) return 'Not Interested';
      if (s.includes('inactive')) return 'Inactive';
      if (s.includes('onboarded')) return 'Onboarded';
      return String(val).trim();
    };

    // Fetch existing customers to check in-memory for fast normalized comparisons
    const existingCustomersList = await Customer.find().lean();

    // Iterate through all rows
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        const contactName = (nameKey && row[nameKey] && String(row[nameKey]).trim()) ? String(row[nameKey]).trim() : 'N/A';
        const company = (companyKey && row[companyKey] && String(row[companyKey]).trim()) ? String(row[companyKey]).trim() : (contactName !== 'N/A' ? contactName : 'N/A');
        const phone = (phoneKey && row[phoneKey] && String(row[phoneKey]).trim()) ? String(row[phoneKey]).trim() : 'N/A';
        const street = (addressKey && row[addressKey] && String(row[addressKey]).trim()) ? String(row[addressKey]).trim() : 'N/A';
        const city = (cityKey && row[cityKey] && String(row[cityKey]).trim()) ? String(row[cityKey]).trim() : 'N/A';
        const state = (stateKey && row[stateKey] && String(row[stateKey]).trim()) ? String(row[stateKey]).trim() : 'N/A';
        const zipCode = (zipKey && row[zipKey] && String(row[zipKey]).trim()) ? String(row[zipKey]).trim() : 'N/A';

        const rawLevelVal = (levelKey && row[levelKey]) ? row[levelKey] : null;
        const { levelStr, priceNum } = parseLevel(rawLevelVal);
        const parsedType = (typeKey && row[typeKey]) ? parseType(row[typeKey]) : 'Fabricator';
        const parsedStatus = (statusKey && row[statusKey]) ? parseStatus(row[statusKey]) : 'Onboarded';

        const rawDisplay = (modaDisplayKey && row[modaDisplayKey]) ? String(row[modaDisplayKey]).trim().toLowerCase() : '';
        const parsedDisplay = (rawDisplay.includes('yes') || rawDisplay === 'y' || rawDisplay === 'true' || rawDisplay === '1') ? 'Yes' : 'No';

        const rawBinder = (modaBinderKey && row[modaBinderKey]) ? String(row[modaBinderKey]).trim() : '0';

        const rawEmail = emailKey ? row[emailKey] : null;
        let email = '';
        if (rawEmail && typeof rawEmail === 'string' && rawEmail.includes('@')) {
          email = rawEmail.toLowerCase().trim();
        } else {
          const safeSlug = normalizeStr(company) || normalizeStr(contactName) || `cust_${Date.now()}_${i}`;
          email = `${safeSlug}@easystones-client.com`;
        }

        const normEmail = email;
        const normCompany = normalizeStr(company);
        const normStreet = normalizeStr(street);

        // Check if customer already exists by real email, valid company name (lowercase, no spaces), or valid street address
        const isExisting = existingCustomersList.some(c => {
          // 1. Real Email match (ignore placeholder @easystones-client.com emails)
          if (normEmail && !normEmail.endsWith('@easystones-client.com') && c.email && c.email.toLowerCase().trim() === normEmail) {
            return true;
          }
          // 2. Company name match (lowercase & no spaces, minimum length 3)
          if (normCompany && normCompany.length > 2 && normCompany !== 'na' && normCompany !== 'unknown' && c.company) {
            const dbNormComp = normalizeStr(c.company);
            if (dbNormComp && dbNormComp.length > 2 && dbNormComp !== 'na' && dbNormComp !== 'unknown' && dbNormComp === normCompany) {
              return true;
            }
          }
          // 3. Real Street address match (minimum length 5)
          if (normStreet && normStreet.length > 4 && normStreet !== 'na' && normStreet !== 'unknown' && c.address?.street) {
            const dbNormStreet = normalizeStr(c.address.street);
            if (dbNormStreet && dbNormStreet.length > 4 && dbNormStreet !== 'na' && dbNormStreet !== 'unknown' && dbNormStreet === normStreet) {
              return true;
            }
          }
          return false;
        });

        if (isExisting) {
          results.skipped++;
          continue;
        } else {
          const hashedPassword = await bcrypt.hash('Welcome123!', 10);

          const newCustomer = new Customer({
            contactName: contactName,
            email: email,
            password: hashedPassword,
            company: company,
            phone: phone,
            address: {
              street: street,
              city: city,
              state: state,
              zipCode: zipCode
            },
            status: parsedStatus,
            customerType: parsedType,
            level: levelStr,
            priceLevel: priceNum,
            modaDisplay: parsedDisplay,
            modaBinder: rawBinder,
            isVerified: true
          });

          await newCustomer.save();
          existingCustomersList.push(newCustomer.toObject());
          results.added++;
        }
      } catch (err) {
        results.errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }

    res.json({ success: true, message: 'Bulk upload processing complete', results });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ message: `Bulk upload failed: ${error.message}` });
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

// Admin: Get lightweight customer list (names only)
app.get('/api/admin/customers/list', verifyToken, async (req, res) => {
  try {
    const customers = await Customer.find()
      .select('_id contactName email company isActive') // Only fields needed for sidebar
      .lean()
      .sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customer list:', error);
    res.status(500).json({ message: 'Failed to fetch customer list', error: error.message });
  }
});

// Admin: Get full customer details by ID
app.get('/api/admin/customers/:id', verifyToken, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('-password');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ message: 'Failed to fetch customer details' });
  }
});

app.get('/api/admin/customers', verifyToken, async (req, res) => {
  try {
    const customers = await Customer.find()
      .select('-password -visits -resources -contacts') // Exclude heavy arrays for list view
      .sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch customers' });
  }
});

// Admin: Create customer
app.post('/api/admin/customers', verifyToken, async (req, res) => {
  try {
    const { contactName, email, password, phone, company, address, priceLevel, marketingEmail, receiveMarketing } = req.body;

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
      company,
      address,
      priceLevel: priceLevel || 1,
      isVerified: true, // Admin created accounts are verified by default
      marketingEmail: marketingEmail || email,
      receiveMarketing: receiveMarketing !== undefined ? receiveMarketing : true
    });

    await customer.save();
    req.app.get('io').emit('customer_update');

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customer: {
        id: customer._id,
        contactName: customer.contactName,
        email: customer.email
      }
    });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ message: `Failed to create customer: ${error.message}` });
  }
});

// Admin: Update customer
app.put('/api/admin/customers/:id', verifyToken, async (req, res) => {
  try {
    const { contactName, email, password, phone, company, address, priceLevel, marketingEmail, receiveMarketing } = req.body;
    const customerId = req.params.id;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Update fields
    customer.contactName = contactName || customer.contactName;
    customer.email = email || customer.email;
    customer.password = password || customer.password;
    customer.phone = phone || customer.phone;
    customer.company = company || customer.company;
    customer.address = address || customer.address;
    customer.priceLevel = priceLevel || customer.priceLevel;

    if (marketingEmail !== undefined) customer.marketingEmail = marketingEmail;
    if (receiveMarketing !== undefined) customer.receiveMarketing = receiveMarketing;

    // Only update password if provided
    if (password && password.trim() !== '') {
      customer.password = password;
    }

    await customer.save();
    req.app.get('io').emit('customer_update');

    res.json({
      success: true,
      message: 'Customer updated successfully',
      customer: {
        id: customer._id,
        contactName: customer.contactName,
        email: customer.email
      }
    });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ message: `Failed to update customer: ${error.message}` });
  }
});

// Admin: Delete customer
app.delete('/api/admin/customers/:id', authenticate, requirePermission('delete_customers'), async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    req.app.get('io').emit('customer_update');
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ message: 'Failed to delete customer' });
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

    const updated = await LostSale.findByIdAndUpdate(
      req.params.id,
      updateObj,
      { new: true }
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

// Admin: Update customer status
app.patch('/api/admin/customers/:id/status', verifyToken, async (req, res) => {
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
app.post('/api/upload', upload.single('image'), async (req, res) => {
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
app.post('/api/upload/delete', async (req, res) => {
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
app.post('/api/products/save', async (req, res) => {
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
app.post('/api/migrate-collection', async (req, res) => {
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
    const { customerName, company, address, phone, email, notes, status, level, customerType, modaDisplay, modaBinder } = req.body;

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

    const newCustomer = new Customer({
      contactName: customerName || company, // Fallback to company if no contact name
      email: customerEmail,
      password: customerPassword,
      company: company,
      phone: phone || '',
      address: {
        street: address?.street || '',
        city: address?.city || '',
        state: address?.state || '',
        zipCode: address?.zipCode || ''
      },
      quickNote: notes || '',
      status: status || 'New',
      level: level || 'Level - 3',
      customerType: customerType || 'Fabricator',
      modaDisplay: modaDisplay || 'No',
      modaBinder: modaBinder || '0',
      isVerified: true, // Auto-verify sales-created accounts
      priceLevel: 1,
      isActive: true
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

