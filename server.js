import dotenv from 'dotenv';
dotenv.config();
// Trigger restart for schema update (v2)

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

// MOVED TO TOP to ensure settings apply to all models
mongoose.set('debug', true);
mongoose.set('autoIndex', false);
mongoose.set('bufferCommands', false); // Disable buffering to fail fast if connection is bad

import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import nodemailer from 'nodemailer';
import compression from 'compression';
import Product from './src/models/Product.js';
import User from './src/models/User.js';
import ContactSubmission from './src/models/ContactSubmission.js';
import Customer from './src/models/Customer.js';
import SalesCustomer from './src/models/SalesCustomer.js';
import SalesResource from './src/models/SalesResource.js';
import SalesDashboardResource from './src/models/SalesDashboardResource.js';
import ActivityLog from './src/models/ActivityLog.js';
import Schedule from './src/models/Schedule.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { read, utils } from 'xlsx';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mockup Generation Utility
const generateMockups = async (slabImageBuffer, baseFilename) => {
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
      
      console.log(`✅ Mockup generated: ${result.secure_url}`);
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

// Base64 to Disk Optimization Utility
const processBase64Image = async (base64String, subDir = 'visits') => {
  if (!base64String || !base64String.startsWith('data:image/')) return base64String;

  try {
    const base64Data = base64String.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    const optimizedBuffer = await optimizeImage(buffer);
    
    const uploadDir = path.join(__dirname, 'public/uploads', subDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `img_${Date.now()}_${Math.round(Math.random() * 1E9)}.webp`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, optimizedBuffer);
    
    return `/uploads/${subDir}/${filename}`;
  } catch (err) {
    console.error('Failed to process base64 image:', err);
    return base64String; // Fallback to original
  }
};

const app = express();
const PORT = process.env.PORT || 3001;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10,
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

    app.listen(PORT, () => {
      console.log(`🚀 Backend server running on port ${PORT}`);
      
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
    const products = await Product.find().sort({ id: -1 }); // Sort by ID descending (newest first)
    
    // Check if customer is logged in
    const token = req.cookies.customerToken;
    let priceLevel = 1; // Default to level 1
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        if (decoded.type === 'customer') {
          const customer = await Customer.findById(decoded.id);
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
      const productObj = product.toObject();
      
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

// JWT Verification Middleware
// JWT Verification Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies.adminToken;
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// Dual Authentication Middleware - accepts both admin and customer tokens
const verifyAnyAuth = (req, res, next) => {
  const adminToken = req.cookies.adminToken;
  const customerToken = req.cookies.customerToken;

  // Try admin token first
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, JWT_SECRET);
      req.userId = decoded.userId;
      req.userRole = decoded.role;
      req.authType = 'admin';
      return next();
    } catch (error) {
      // Admin token invalid, try customer token
    }
  }

  // Try customer token
  if (customerToken) {
    try {
      const decoded = jwt.verify(customerToken, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
      if (decoded.type === 'customer' || decoded.type === 'internal') {
        req.customerId = decoded.id;
        
        // If internal user, also set userId so admin routes work
        if (decoded.type === 'internal') {
            req.userId = decoded.id;
        }

        req.accountType = decoded.type;
        req.authType = decoded.type === 'customer' ? 'customer' : 'admin'; 
        return next();
      }
    } catch (error) {
      // Customer token invalid
    }
  }

  // No valid token found
  return res.status(401).json({ error: 'Access denied. No valid token provided.' });
};

// Role Authorization Middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
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
    
    // Generate JWT
    const token = jwt.sign(
      { 
        userId: user._id, 
        username: user.username,
        role: user.role 
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
    
    res.json({ 
      success: true, 
      message: 'Login successful',
      admin: { 
        username: user.username, 
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Get all users (Admin/Director only)
app.get('/api/admin/users', verifyToken, authorize('admin', 'director'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// Create new user (Admin/Director only)
app.post('/api/admin/users', verifyToken, authorize('admin', 'director'), async (req, res) => {
  try {
    const { username, password, email, role, location } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const newUser = new User({
      username,
      password,
      email,
      role: role || 'sales_rep',
      location
    });

    await newUser.save();
    
    res.status(201).json({ 
      message: 'User created successfully', 
      user: { 
        id: newUser._id, 
        username: newUser.username, 
        email: newUser.email, 
        role: newUser.role,
        location: newUser.location
      } 
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user', error: error.message });
  }
});

// Update user (Admin/Director only)
app.put('/api/admin/users/:id', verifyToken, authorize('admin', 'director'), async (req, res) => {
  try {
    const { username, email, role, password, location } = req.body;
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

    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (location !== undefined) user.location = location;
    if (password) user.password = password; // Will be hashed by pre-save hook

    await user.save();

    res.json({
      message: 'User updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        location: user.location
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

// Delete user (Admin/Director only)
app.delete('/api/admin/users/:id', verifyToken, authorize('admin', 'director'), async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete user' });
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
    
    console.log('Password change attempt for adminId:', adminId);

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

    console.log('Password changed successfully for adminId:', adminId);
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

// Verify token endpoint
app.get('/api/auth/verify', verifyAnyAuth, (req, res) => {
  res.json({ 
    valid: true, 
    id: req.userId || req.customerId, 
    role: req.userRole || 'customer',
    authType: req.authType
  });
});

// Get current user info (for admin/internal users)
app.get('/api/user/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role
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

    // Try to send email if credentials are configured
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: process.env.SMTP_PORT || 587,
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });

        const mailOptions = {
          from: process.env.SMTP_USER,
          to: 'krish@easystones.com',
          subject: `New Contact Form Submission from ${name}`,
          html: `
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Company:</strong> ${company || 'N/A'}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
            <p><strong>Message:</strong></p>
            <p>${message.replace(/\n/g, '<br>')}</p>
          `,
          replyTo: email
        };

        await transporter.sendMail(mailOptions);
        contactSubmission.emailSent = true;
        await contactSubmission.save();
        console.log(`✅ Email sent to krish@easystones.com from ${email}`);
      } catch (emailError) {
        console.error('⚠️ Email sending failed (but saved to database):', emailError.message);
      }
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
      process.env.JWT_SECRET,
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

    // Generate JWT token
    console.log(`🔑 Generating JWT for ${email} (Type: ${accountType})`);
    const token = jwt.sign(
      { 
        id: account._id, 
        type: accountType,
        role: account.role || 'customer'
      },
      process.env.JWT_SECRET,
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
        contactName: accountType === 'customer' ? account.contactName : (account.username || account.email),
        email: account.email,
        company: account.company || 'Easy Stones Internal',
        role: account.role || 'customer',
        type: accountType
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
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

    res.json({
      id: account._id,
      contactName: req.accountType === 'customer' ? account.contactName : (account.username || account.email),
      email: account.email,
      company: account.company || (req.accountType === 'internal' ? 'Easy Stones Internal' : ''),
      role: account.role || 'customer',
      type: req.accountType
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    
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
        const user = await User.findById(req.userId).select('username');
        name = user ? user.username : `Unknown User (${req.userId})`;
    } else if (req.authType === 'customer') {
        id = req.customerId;
        const customer = await Customer.findById(req.customerId).select('contactName email');
        name = customer ? (customer.contactName || customer.email) : `Unknown Customer (${req.customerId})`;
    }

    return { id, name, role };
};

// Customer-accessible endpoint: Get all customers (for sales page)
// Customer-accessible endpoint: Get all customers (for sales page) - Optimized (No images)
app.get('/api/customers', verifyAnyAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    
    let query = {};
    if (search) {
      query = {
        $or: [
          { contactName: { $regex: search, $options: 'i' } },
          { company: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const total = await Customer.countDocuments(query);
    console.log('🔍 [DEBUG] /api/customers query:', query);
    console.log('🔍 [DEBUG] /api/customers total found:', total);
    const customers = await Customer.find(query)
      .select('-password -contacts -visits.image -resources.image')
      .lean()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

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

// Get dashboard statistics (optimized aggregation)
app.get('/api/dashboard/stats', verifyAnyAuth, async (req, res) => {
  try {
    const { timeRange = 'all' } = req.query;
    const now = new Date();
    let startDate = null;
    let endDate = null;

    if (timeRange === '1day') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (timeRange === '7days') {
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (timeRange === '30days') {
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    } else if (timeRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    const { id: userId, role } = req.authType === 'admin' ? { id: req.userId, role: 'admin' } : { id: req.customerId, role: 'customer' };
    const isAdmin = ['admin', 'director', 'manager'].includes(role);

    // Strictly filter by current user for the dashboard view
    const userMatch = { "visits.createdBy": userId.toString() };
    const dateMatch = startDate ? (endDate ? {
        $expr: { 
            $and: [
                { $gte: [{ $ifNull: ["$visits.date", "$visits.createdAt"] }, startDate] },
                { $lte: [{ $ifNull: ["$visits.date", "$visits.createdAt"] }, endDate] }
            ]
        } 
    } : {
        $expr: { 
            $gte: [
                { $ifNull: ["$visits.date", "$visits.createdAt"] }, 
                startDate 
            ] 
        } 
    }) : {};

    // Aggregation for Visits Stats
    const visitStats = await Customer.aggregate([
      { $unwind: "$visits" },
      { $match: { ...userMatch, ...dateMatch } },
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
          followUp: {
            $sum: {
              $cond: [
                {
                  $or: [
                        { $and: ["$visits.nextAction", { $ne: ["$visits.nextAction", ""] }] },
                        { $and: ["$visits.followUp", { $ne: ["$visits.followUp", ""] }] }
                      ]
                },
                1, 0
              ]
            }
          }
        }
      }
    ]);

    // Today's Schedule count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const scheduleCount = await Customer.aggregate([
      { $unwind: "$visits" },
      {
        $match: {
          ...userMatch,
          "visits.followUpDate": { $gte: todayStart, $lt: todayEnd }
        }
      },
      { $count: "count" }
    ]);

    // Strictly filter by current user for dashboard resources
    const resourceMatch = { 
        $or: [
            { "resources.uploadedBy": userId.toString() },
            { "resources.createdBy": userId.toString() }
        ]
    };
    const resourceDateMatch = startDate ? (endDate ? {
        $expr: { 
            $and: [
                { $gte: [{ $ifNull: ["$resources.date", "$resources.createdAt"] }, startDate] },
                { $lte: [{ $ifNull: ["$resources.date", "$resources.createdAt"] }, endDate] }
            ]
        } 
    } : {
        $expr: { 
            $gte: [
                { $ifNull: ["$resources.date", "$resources.createdAt"] }, 
                startDate 
            ] 
        } 
    }) : {};
    
    const resourceStats = await Customer.aggregate([
      { $unwind: "$resources" },
      { $match: { ...resourceMatch, ...resourceDateMatch } },
      { $count: "count" }
    ]);

    const result = {
      visits: visitStats[0]?.visits || 0,
      keyVisits: visitStats[0]?.keyVisits || 0,
      bids: visitStats[0]?.bids || 0,
      followUp: visitStats[0]?.followUp || 0,
      resources: resourceStats[0]?.count || 0,
      todayScheduleCount: scheduleCount[0]?.count || 0
    };

    res.json(result);
  } catch (error) {
    console.error('Error calculating dashboard stats:', error);
    res.status(500).json({ message: 'Failed to calculate dashboard stats', error: error.message });
  }
});

// Get dashboard visits (returns a flat list for all customers in range)
app.get('/api/dashboard/visits', verifyAnyAuth, async (req, res) => {
    try {
        const { timeRange = 'all' } = req.query;
        const now = new Date();
        let startDate = null;
        let endDate = null;

        if (timeRange === '1day') {
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
        } else if (timeRange === '7days') {
            startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        } else if (timeRange === '30days') {
            startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        } else if (timeRange === 'year') {
            startDate = new Date(now.getFullYear(), 0, 1);
        }

        const { id: userId, role } = req.authType === 'admin' ? { id: req.userId, role: 'admin' } : { id: req.customerId, role: 'customer' };
        const isAdmin = ['admin', 'director', 'manager'].includes(role);

        // Strictly filter by current user for the dashboard list
        const userMatch = { "visits.createdBy": userId.toString() };
        const dateMatch = startDate ? (endDate ? {
            $expr: { 
                $and: [
                    { $gte: [{ $ifNull: ["$visits.date", "$visits.createdAt"] }, startDate] },
                    { $lte: [{ $ifNull: ["$visits.date", "$visits.createdAt"] }, endDate] }
                ]
            } 
        } : {
            $expr: { 
                $gte: [
                    { $ifNull: ["$visits.date", "$visits.createdAt"] }, 
                    startDate 
                ] 
            } 
        }) : {};

        const visits = await Customer.aggregate([
            { $unwind: "$visits" },
            { $match: { ...userMatch, ...dateMatch } },
            { $project: {
                _id: "$visits._id",
                date: { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: { $ifNull: ["$visits.date", "$visits.createdAt"] } } },
                purpose: "$visits.purpose",
                notes: "$visits.notes",
                outcome: "$visits.outcome",
                nextAction: "$visits.nextAction",
                followUp: "$visits.followUp",
                followUpDate: { 
                    $cond: {
                        if: "$visits.followUpDate",
                        then: { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$visits.followUpDate" } },
                        else: null
                    }
                },
                createdBy: "$visits.createdBy",
                createdAt: { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$visits.createdAt" } },
                customerId: "$_id",
                customerName: { $concat: [ 
                    { $ifNull: ["$company", ""] }, 
                    { $cond: [{ $and: ["$company", "$contactName"] }, " - ", ""] }, 
                    { $ifNull: ["$contactName", ""] } 
                ]}
            }},
            { $sort: { date: -1, createdAt: -1 } }
        ]);

        res.json(visits);
    } catch (error) {
        console.error('Error fetching dashboard visits:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard visits' });
    }
});

// Get dashboard resources (returns a flat list for all customers in range)
app.get('/api/dashboard/resources', verifyAnyAuth, async (req, res) => {
    try {
        const { timeRange = 'all' } = req.query;
        const now = new Date();
        let startDate = null;
        let endDate = null;

        if (timeRange === '1day') {
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
        } else if (timeRange === '7days') {
            startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        } else if (timeRange === '30days') {
            startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        } else if (timeRange === 'year') {
            startDate = new Date(now.getFullYear(), 0, 1);
        }

        const { id: userId, role } = req.authType === 'admin' ? { id: req.userId, role: 'admin' } : { id: req.customerId, role: 'customer' };
        const isAdmin = ['admin', 'director', 'manager'].includes(role);

        // Strictly filter by current user for dashboard resources list
        const resourceMatch = { 
            $or: [
                { "resources.uploadedBy": userId.toString() },
                { "resources.createdBy": userId.toString() }
            ]
        };
        const resourceDateMatch = startDate ? (endDate ? {
            $expr: { 
                $and: [
                    { $gte: [{ $ifNull: ["$resources.date", "$resources.createdAt"] }, startDate] },
                    { $lte: [{ $ifNull: ["$resources.date", "$resources.createdAt"] }, endDate] }
                ]
            } 
        } : {
            $expr: { 
                $gte: [
                    { $ifNull: ["$resources.date", "$resources.createdAt"] }, 
                    startDate 
                ] 
            } 
        }) : {};

        const resources = await Customer.aggregate([
            { $unwind: "$resources" },
            { $match: { ...resourceMatch, ...resourceDateMatch } },
            { $project: {
                _id: "$resources._id",
                name: "$resources.name",
                description: "$resources.description",
                type: "$resources.type",
                resourceType: "$resources.resourceType",
                date: { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: { $ifNull: ["$resources.date", "$resources.createdAt"] } } },
                content: "$resources.content",
                uploadedBy: "$resources.uploadedBy",
                createdAt: { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$resources.createdAt" } },
                customerId: "$_id",
                customerName: { $concat: [ 
                    { $ifNull: ["$company", ""] }, 
                    { $cond: [{ $and: ["$company", "$contactName"] }, " - ", ""] }, 
                    { $ifNull: ["$contactName", ""] } 
                ]}
            }},
            { $sort: { date: -1, createdAt: -1 } }
        ]);

        res.json(resources);
    } catch (error) {
        console.error('Error fetching dashboard resources:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard resources' });
    }
});

// Get single customer with full details (including images)
app.get('/api/customers/:id', verifyAnyAuth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('-password');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ message: 'Failed to fetch customer details', error: error.message });
  }
});

// ============================================
// CONTACTS CRUD ENDPOINTS
// ============================================

// Add contact to customer
app.post('/api/customers/:customerId/contacts', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { name, phone, email, role, isPrimary, notes } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Contact name is required' });
    }

    const newContact = {
      name,
      phone,
      email,
      role,
      isPrimary: isPrimary || false,
      notes,
      createdAt: new Date(),
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

// Update contact
app.put('/api/customers/:customerId/contacts/:contactId', verifyAnyAuth, async (req, res) => {
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
    console.log('📁 Fetching dashboard resources with query:', query);
    
    // Also support getting ALL resources if specifically requested (for search maybe?) - avoiding for now to keep simple
    const resources = await SalesDashboardResource.find(query)
      .select('-content')
      .populate('uploadedBy', 'username') // Populate username
      .sort({ isFolder: -1, createdAt: -1 }); // Folders first, exclude content
    console.log(`📁 Found ${resources.length} resources`);
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
        console.log(`[DEBUG] Optimizing image: ${req.file.originalname}`);
        buffer = await optimizeImage(req.file.buffer);
        filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueSuffix}.webp`;
        contentType = 'image/webp';
      } else {
        filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueSuffix}${path.extname(req.file.originalname)}`;
        contentType = req.file.mimetype;
      }

      const filePath = path.join(uploadDir, filename);
      fs.writeFileSync(filePath, buffer);
      
      content = `/uploads/resources/${filename}`;
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
      uploadedBy: req.userId // Save the user who uploaded/created
    });

    const startSave = Date.now();
    await newResource.save();
    
    // Populate before returning
    await newResource.populate('uploadedBy', 'username');

    console.log(`✅ [UPLOAD] Resource saved successfully in ${Date.now() - startSave}ms:`, {
      name: newResource.name,
      type: newResource.type,
      isFolder: newResource.isFolder,
      parentId: newResource.parentId,
      id: newResource._id,
      uploadedBy: newResource.uploadedBy?.username
    });
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
      let filename = '';
      let buffer = req.file.buffer;

      if (isImage) {
        buffer = await optimizeImage(req.file.buffer);
        filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueSuffix}.webp`;
        resource.contentType = 'image/webp';
      } else {
        filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueSuffix}${path.extname(req.file.originalname)}`;
        resource.contentType = req.file.mimetype;
      }

      const filePath = path.join(uploadDir, filename);
      fs.writeFileSync(filePath, buffer);
      
      resource.content = `/uploads/resources/${filename}`;
    } else if (type === 'link' && linkContent) {
      resource.content = linkContent;
      resource.contentType = 'text/uri-list';
    }

    if (thumbnail) resource.thumbnail = thumbnail;

    await resource.save();
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
    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Error deleting resource:', error);
    res.status(500).json({ message: 'Failed to delete resource' });
  }
});



// ============================================
// VISITS CRUD ENDPOINTS
// ============================================

// Get single visit detail
app.get('/api/customers/:customerId/visits/:visitId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, visitId } = req.params;
    console.log(`[DEBUG] Fetching single visit: ${visitId} for customer: ${customerId}`);
    
    // Use projection to get ONLY the specific visit
    const customer = await Customer.findOne(
      { _id: customerId, 'visits._id': visitId },
      { 'visits.$': 1 }
    ).lean();

    if (!customer || !customer.visits || customer.visits.length === 0) {
      console.log(`[DEBUG] Visit ${visitId} not found`);
      return res.status(404).json({ message: 'Visit not found' });
    }
    
    const visit = customer.visits[0];
    console.log(`[DEBUG] Found visit. Image count: ${visit.image ? (Array.isArray(visit.image) ? visit.image.length : 1) : 0}`);
    
    res.json({ visit });
  } catch (error) {
    console.error('[ERROR] Failed to fetch visit detail:', error);
    res.status(500).json({ message: 'Failed to fetch visit detail', error: error.message });
  }
});

// Get single resource detail
app.get('/api/customers/:customerId/resources/:resourceId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;
    console.log(`[DEBUG] Fetching single resource: ${resourceId} for customer: ${customerId}`);

    // Use projection to get ONLY the specific resource
    const customer = await Customer.findOne(
      { _id: customerId, 'resources._id': resourceId },
      { 'resources.$': 1 }
    ).lean();

    if (!customer || !customer.resources || customer.resources.length === 0) {
      console.log(`[DEBUG] Resource ${resourceId} not found`);
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    const resource = customer.resources[0];
    console.log(`[DEBUG] Found resource. Image count: ${resource.image ? (Array.isArray(resource.image) ? resource.image.length : 1) : 0}`);
    
    res.json({ resource });
  } catch (error) {
    console.error('[ERROR] Failed to fetch resource detail:', error);
    res.status(500).json({ message: 'Failed to fetch resource detail', error: error.message });
  }
});

// Add visit
app.post('/api/customers/:customerId/visits', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { date, purpose, notes, outcome, followUp, followUpDate, managerComment, headquartersComment, image } = req.body;

    console.log(`[DEBUG] Received visit creation request for Customer: ${customerId}`);
    console.log(`[DEBUG] Auth type: ${req.authType}, User ID: ${req.userId || req.customerId}`);
    console.log(`[DEBUG] Payload size (approx): ${JSON.stringify(req.body).length} chars`);

    if (!date) {
      console.log('[DEBUG] Missing date in payload');
      return res.status(400).json({ message: 'Visit date is required' });
    }

    // Check if customer exists first (using lean query)
    const customerExists = await Customer.findById(customerId).select('_id');
    if (!customerExists) {
      console.log(`[DEBUG] Customer ${customerId} not found`);
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Get creator information based on auth type
    const { id: createdBy, name: createdByName } = await getPerformerInfo(req);

    // Get the customer's contact name (the customer being visited)
    const visitedCustomer = await Customer.findById(customerId).select('contactName company');
    const customerContactName = visitedCustomer ? (visitedCustomer.company || visitedCustomer.contactName) : '';

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
      date,
      purpose,
      notes,
      outcome,
      followUp,
      followUpDate,
      managerComment,
      headquartersComment,
      image: processedImage,
      createdBy,
      createdByName,
      customerContactName,
      createdAt: new Date()
    };
    
    console.log(`[DEBUG] Prepared visit data with ID: ${visitId}. Image count: ${image && Array.isArray(image) ? image.length : (image ? 1 : 0)}`);

    // Use atomic $push to add the visit without loading the entire document
    const startUpdate = Date.now();
    const result = await Customer.updateOne(
      { _id: customerId },
      { $push: { visits: visitData } }
    );
    console.log(`[DEBUG] UpdateOne completed in ${Date.now() - startUpdate}ms`);

    if (result.matchedCount === 0) {
        console.error(`[DEBUG] ERROR: Update match count is 0. ID ${customerId} might not exist?`);
        return res.status(404).json({ message: 'Customer not found or update failed' });
    }

    console.log('Saved visit atomically with image:', !!image, 'Image length:', image ? image.length : 0);
    
    // Return only the new visit data instead of the whole array
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
app.put('/api/customers/:customerId/visits/:visitId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, visitId } = req.params;
    const { date, purpose, notes, outcome, followUp, followUpDate, managerComment, headquartersComment, image } = req.body;

    // Get updater information
    // Get updater information
    const { id: updatedBy, name: updatedByName } = await getPerformerInfo(req);

    const updateData = {};
    if (date) updateData['visits.$.date'] = date;
    if (purpose !== undefined) updateData['visits.$.purpose'] = purpose;
    if (notes !== undefined) updateData['visits.$.notes'] = notes;
    if (outcome !== undefined) updateData['visits.$.outcome'] = outcome;
    if (followUp !== undefined) updateData['visits.$.followUp'] = followUp;
    if (followUpDate !== undefined) updateData['visits.$.followUpDate'] = followUpDate;
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
    updateData['visits.$.updatedAt'] = new Date();

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
app.delete('/api/customers/:customerId/visits/:visitId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, visitId } = req.params;

    // Get performer information
    // Get performer information
    const { id: performedBy, name: performedByName } = await getPerformerInfo(req);

    // Find the visit before deleting to get its details if needed (optional)
    const customer = await Customer.findById(customerId).select('visits');
    const visit = customer ? customer.visits.id(visitId) : null;

    const result = await Customer.updateOne(
      { _id: customerId },
      { $pull: { visits: { _id: visitId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

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
  console.log('[DEBUG] GET /api/schedule hit');
  try {
    const userId = req.userId || req.customerId;
    const { start, end } = req.query;
    
    let query = { userId };
    
    if (start && end) {
      query.startTime = { $gte: new Date(start), $lte: new Date(end) };
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

// Toggle reaction on visit
app.post('/api/customers/:customerId/visits/:visitId/react', verifyAnyAuth, async (req, res) => {
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
        userName = user ? user.username : 'Admin';
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
            userName
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
app.post('/api/customers/:customerId/resources', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { title, date, customer, location, resourceType, image, description, notes, status, url, uploadedBy } = req.body;

    // If title is missing but resourceType is present, use resourceType as title
    const finalTitle = title || resourceType;

    if (!finalTitle) {
      return res.status(400).json({ message: 'Resource title or type is required' });
    }

    const newResource = {
      title: finalTitle,
      date: date || new Date(),
      customer: customer || '',
      location: location || '',
      resourceType: resourceType || '',
      image: image || [],
      description: description || '',
      notes: notes || '',
      status: status || 'Active',
      url: url || '',
      uploadedBy: uploadedBy || (await getPerformerInfo(req)).id,
      createdAt: new Date()
    };

    const result = await Customer.updateOne(
      { _id: customerId },
      { $push: { resources: newResource } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.status(201).json({ success: true, resource: newResource });
  } catch (error) {
    console.error('Add resource error:', error);
    res.status(500).json({ message: `Failed to add resource: ${error.message}` });
  }
});

// Update resource
app.put('/api/customers/:customerId/resources/:resourceId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;
    const fields = req.body;

    const updateData = {};
    Object.keys(fields).forEach(key => {
      // If title is missing but resourceType is present, use resourceType as title
      if (key === 'resourceType' && !fields.title) {
          updateData['resources.$.title'] = fields[key];
      }
      updateData[`resources.$.${key}`] = fields[key];
    });

    const result = await Customer.updateOne(
      { _id: customerId, 'resources._id': resourceId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or resource not found' });
    }

    res.json({ success: true, message: 'Resource updated successfully' });
  } catch (error) {
    console.error('Update resource error:', error);
    res.status(500).json({ message: 'Failed to update resource' });
  }
});

// Delete resource
app.delete('/api/customers/:customerId/resources/:resourceId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, resourceId } = req.params;

    const result = await Customer.updateOne(
      { _id: customerId },
      { $pull: { resources: { _id: resourceId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

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

    console.log('Bulk Upload - Detected Column Mapping:', { 
        email: emailKey, 
        name: nameKey, 
        company: companyKey,
        phone: phoneKey 
    });

    if (!emailKey) {
        return res.status(400).json({ 
            message: 'Could not detect an "Email" column. Please ensure your Excel file has a column header containing "Email".' 
        });
    }

    const results = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    // Iterate through all rows
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        const rawEmail = row[emailKey];

        if (!rawEmail || typeof rawEmail !== 'string') {
            // Only report error if the row looks like it should contain data (has other fields)
            if (Object.keys(row).length > 2) {
                results.errors.push(`Row ${i + 2}: Missing or invalid email`);
            }
            continue;
        }
        
        // Basic validation
        if (!rawEmail.includes('@')) {
             results.errors.push(`Row ${i + 2}: Invalid email format "${rawEmail}"`);
             continue;
        }

        const email = rawEmail.toLowerCase().trim();

        let customer = await Customer.findOne({ email: email });
        
        // Prepare data from row
        const contactName = (nameKey && row[nameKey]) ? String(row[nameKey]).trim() : 'Unknown';
        const company = (companyKey && row[companyKey]) ? String(row[companyKey]).trim() : contactName;
        const phone = (phoneKey && row[phoneKey]) ? String(row[phoneKey]).trim() : '';
        const street = (addressKey && row[addressKey]) ? String(row[addressKey]).trim() : '';
        const city = (cityKey && row[cityKey]) ? String(row[cityKey]).trim() : '';
        const state = (stateKey && row[stateKey]) ? String(row[stateKey]).trim() : '';
        const zipCode = (zipKey && row[zipKey]) ? String(row[zipKey]).trim() : '';

        if (customer) {
          // Update existing customer
          if (nameKey && row[nameKey]) customer.contactName = contactName;
          if (companyKey && row[companyKey]) customer.company = company;
          if (phoneKey && row[phoneKey]) customer.phone = phone;
          
          if (addressKey && row[addressKey]) customer.address.street = street;
          if (cityKey && row[cityKey]) customer.address.city = city;
          if (stateKey && row[stateKey]) customer.address.state = state;
          if (zipKey && row[zipKey]) customer.address.zipCode = zipCode;
          
          await customer.save();
          results.updated++;
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
          isVerified: true,
          priceLevel: 1 // Default level
        });

        await newCustomer.save();
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
    const { contactName, email, password, phone, company, address, priceLevel } = req.body;

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
      isVerified: true // Admin created accounts are verified by default
    });

    await customer.save();

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
    const { contactName, email, password, phone, company, address, priceLevel } = req.body;
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

    // Only update password if provided
    if (password && password.trim() !== '') {
      customer.password = password;
    }

    await customer.save();

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
app.delete('/api/admin/customers/:id', verifyToken, async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
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
        resource_type: 'image'
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(optimizedBuffer);
  });
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

    // DEBUG: Check for bundles
    const sampleWithBundles = products.find(p => p.bundles && p.bundles.length > 0);
    if (sampleWithBundles) {
      console.log('📦 [DEBUG] Received product with bundles:', sampleWithBundles.name);
      console.log('📦 [DEBUG] Bundle Count:', sampleWithBundles.bundles.length);
      console.log('📦 [DEBUG] Full Bundles Payload:', JSON.stringify(sampleWithBundles.bundles, null, 2));
    } else {
      console.log('⚠️ [DEBUG] No products with bundles found in payload.');
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
      
      // Debug: Log pricing data
      if (productData.landingCost || productData.priceLevels) {
        console.log(`💰 Saving pricing for product ${product.id}:`, {
          landingCost: productData.landingCost,
          priceLevels: productData.priceLevels
        });
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

    console.log('✅ Products saved successfully');
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
  } catch (error) {
    console.error('❌ Error during migration:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
  }
});

// ============================================
// SALES CRM API ENDPOINTS
// ============================================

// Get all sales customers for logged-in user
// Get all sales customers (Global access for all authenticated users)
app.get('/api/sales/customers', verifyToken, async (req, res) => {
  try {
    const customers = await SalesCustomer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error('Error fetching sales customers:', error);
    res.status(500).json({ message: 'Failed to fetch customers' });
  }
});

// Create new sales customer
// Create new sales customer
app.post('/api/sales/customers', verifyToken, async (req, res) => {
  try {
    const { customerName, company, address, coordinates, phone, email, notes, lastVisit, nextVisit, status, tags } = req.body;

    if (!customerName || !address) {
      return res.status(400).json({ message: 'Customer name and address are required' });
    }

    const salesCustomer = new SalesCustomer({
      userId: req.userId, // Use the authenticated user's ID
      customerName,
      company,
      address,
      coordinates,
      phone,
      email,
      notes,
      lastVisit,
      nextVisit,
      status,
      tags
    });

    await salesCustomer.save();
    res.status(201).json(salesCustomer);
  } catch (error) {
    console.error('Error creating sales customer:', error);
    res.status(500).json({ message: 'Failed to create customer' });
  }
});

// Update sales customer
// Update sales customer
app.put('/api/sales/customers/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Allow update of any customer (Global access)
    const customer = await SalesCustomer.findById(id);
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    Object.assign(customer, updates);
    await customer.save();

    res.json(customer);
  } catch (error) {
    console.error('Error updating sales customer:', error);
    res.status(500).json({ message: 'Failed to update customer' });
  }
});

// Delete sales customer
// Delete sales customer
app.delete('/api/sales/customers/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Allow delete of any customer (Global access)
    const customer = await SalesCustomer.findByIdAndDelete(id);
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting sales customer:', error);
    res.status(500).json({ message: 'Failed to delete customer' });
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
    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Error deleting sales resource:', error);
    res.status(500).json({ message: 'Failed to delete resource' });
  }
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbStatusMap = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dbStatus: dbStatusMap[mongoose.connection.readyState] || 'unknown',
    dbHost: mongoose.connection.host
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
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false // Don't serve index.html with long cache
  }));
  
  app.get(/(.*)/, (req, res) => {
    // Send index.html with NO CACHE so users always get the latest version of the app
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
