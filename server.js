import dotenv from 'dotenv';
dotenv.config();

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
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { read, utils } from 'xlsx';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const uploadMemory = multer({ storage: memoryStorage });

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
      { expiresIn: '24h' }
    );
    
    // Set HTTP-only cookie
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
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

// Create new user (Admin only)
app.post('/api/admin/users', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { username, password, email, role } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const newUser = new User({
      username,
      password,
      email,
      role: role || 'sales_rep'
    });

    await newUser.save();
    
    res.status(201).json({ 
      message: 'User created successfully', 
      user: { 
        id: newUser._id, 
        username: newUser.username, 
        email: newUser.email, 
        role: newUser.role 
      } 
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user', error: error.message });
  }
});

// Delete user (Admin only)
app.delete('/api/admin/users/:id', verifyToken, authorize('admin'), async (req, res) => {
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
    const adminId = req.adminId;
    
    console.log('Password change attempt for adminId:', adminId);

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    // Verify current password
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      console.log('Current password incorrect');
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Update password (pre-save hook in Admin model will hash it)
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
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Verify token endpoint
app.get('/api/auth/verify', verifyToken, (req, res) => {
  res.json({ valid: true });
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
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('customerToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
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

    // Find customer - Exclude heavy arrays to prevent timeouts on high-latency networks
    console.log(`[${new Date().toISOString()}] 🔍 DB QUERY START: Finding customer ${email}`);
    const startQuery = Date.now();
    let customer;
    try {
      customer = await Customer.findOne({ email }).select('-visits -resources');
      console.log(`[${new Date().toISOString()}] ⏱️ DB QUERY END: Took ${Date.now() - startQuery}ms`);

      if (!customer) {
        console.log(`[${new Date().toISOString()}] ❌ Customer not found: ${email}`);
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Verify password
      console.log(`[${new Date().toISOString()}] 🔐 CRYPTO START: Verifying password for ${email}`);
      const startCrypto = Date.now();
      const isMatch = await customer.comparePassword(password);
      console.log(`[${new Date().toISOString()}] ⏱️ CRYPTO END: Verification took ${Date.now() - startCrypto}ms`);
      
      if (!isMatch) {
        console.log(`[${new Date().toISOString()}] ❌ Password mismatch for ${email}`);
        await customer.incLoginAttempts();
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    } catch (dbError) {
      console.error(`[${new Date().toISOString()}] ❌ DB ERROR during findOne:`, dbError);
      throw dbError; 
    }

    // Reset login attempts and save IP address atomically
    // Reset login attempts and save IP address atomically using updateOne
    // We use updateOne instead of findByIdAndUpdate/save to avoid fetching the full 1MB document back
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`💾 Updating customer login info (IP: ${ip}) for ${email}`);
    
    await Customer.updateOne({ _id: customer._id }, {
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

    // Generate JWT token
    console.log(`🔑 Generating JWT for ${email}`);
    const token = jwt.sign(
      { id: customer._id, type: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('customerToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log(`✅ Login successful for ${email}`);
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: customer._id,
        contactName: customer.contactName,
        email: customer.email,
        company: customer.company
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
    if (decoded.type !== 'customer') {
      return res.status(401).json({ message: 'Invalid token type.' });
    }
    req.customerId = decoded.id;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

// Get current customer
app.get('/api/customer/me', verifyCustomer, async (req, res) => {
  try {
    const customer = await Customer.findById(req.customerId).select('-password -visits -resources');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json({
      id: customer._id,
      contactName: customer.contactName,
      email: customer.email,
      company: customer.company
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ message: 'Failed to fetch customer data' });
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

    if (decoded.type !== 'customer') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const customer = await Customer.findById(decoded.id);

    if (!customer || !customer.isActive) {
      return res.status(403).json({ message: 'Account inactive or not found' });
    }

    req.customerId = decoded.id;
    req.customer = customer;
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
    sameSite: 'strict'
  });
  res.json({ message: 'Logged out successfully' });
});

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
      if (decoded.type === 'customer') {
        req.customerId = decoded.id;
        req.authType = 'customer';
        return next();
      }
    } catch (error) {
      // Customer token invalid
    }
  }

  // No valid token found
  return res.status(401).json({ error: 'Access denied. No valid token provided.' });
};

// Customer-accessible endpoint: Get all customers (for sales page)
// Customer-accessible endpoint: Get all customers (for sales page) - Optimized (No images)
app.get('/api/customers', verifyAnyAuth, async (req, res) => {
  try {
    const customers = await Customer.find()
      .select('-password -visits.image -resources.image')
      .sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ message: 'Failed to fetch customers', error: error.message });
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
      createdAt: new Date()
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
    res.status(500).json({ message: 'Error updating password' });
  }
});

// ============================================
// VISITS CRUD ENDPOINTS
// ============================================

// Add visit
// Add visit
app.post('/api/customers/:customerId/visits', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { date, purpose, notes, outcome, nextAction, image } = req.body;

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
    let createdBy = '';
    let createdByName = '';

    if (req.authType === 'admin') {
      createdBy = req.userId;
      const user = await User.findById(req.userId).select('username');
      createdByName = user ? user.username : 'Unknown User';
    } else if (req.authType === 'customer') {
      createdBy = req.customerId;
      // Get contactName with lean query to avoid loading massive arrays
      const customerUser = await Customer.findById(req.customerId).select('contactName');
      createdByName = customerUser ? customerUser.contactName : 'Unknown Customer';
    }

    const visitData = {
      date,
      purpose,
      notes,
      outcome,
      nextAction,
      image,
      createdBy,
      createdByName,
      createdAt: new Date()
    };
    
    console.log(`[DEBUG] Prepared visit data for update. Image count: ${image && Array.isArray(image) ? image.length : (image ? 1 : 0)}`);

    // Use atomic $push to add the visit without loading the entire document
    const startUpdate = Date.now();
    const result = await Customer.updateOne(
      { _id: customerId },
      { $push: { visits: visitData } }
    );
    console.log(`[DEBUG] UpdateOne completed in ${Date.now() - startUpdate}ms`);
    console.log('[DEBUG] Update result:', result);

    if (result.matchedCount === 0) {
        console.error(`[DEBUG] ERROR: Update match count is 0. ID ${customerId} might not exist?`);
        return res.status(404).json({ message: 'Customer not found or update failed' });
    }

    console.log('Saved visit atomically with image:', !!image, 'Image length:', image ? image.length : 0);
    
    // Return only the new visit data instead of the whole array
    res.status(201).json({ success: true, visit: visitData });
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
    const { date, purpose, notes, outcome, nextAction, image } = req.body;

    const updateData = {};
    if (date) updateData['visits.$.date'] = date;
    if (purpose !== undefined) updateData['visits.$.purpose'] = purpose;
    if (notes !== undefined) updateData['visits.$.notes'] = notes;
    if (outcome !== undefined) updateData['visits.$.outcome'] = outcome;
    if (nextAction !== undefined) updateData['visits.$.nextAction'] = nextAction;
    if (image !== undefined) updateData['visits.$.image'] = image;

    const result = await Customer.updateOne(
      { _id: customerId, 'visits._id': visitId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer or visit not found' });
    }

    res.json({ success: true, message: 'Visit updated successfully' });
  } catch (error) {
    console.error('Update visit error:', error);
    res.status(500).json({ message: 'Failed to update visit' });
  }
});

// Delete visit
app.delete('/api/customers/:customerId/visits/:visitId', verifyAnyAuth, async (req, res) => {
  try {
    const { customerId, visitId } = req.params;

    const result = await Customer.updateOne(
      { _id: customerId },
      { $pull: { visits: { _id: visitId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ success: true, message: 'Visit deleted successfully' });
  } catch (error) {
    console.error('Delete visit error:', error);
    res.status(500).json({ message: 'Failed to delete visit' });
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
      uploadedBy: uploadedBy || '',
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

app.get('/api/admin/customers', verifyToken, async (req, res) => {
  try {
    const customers = await Customer.find().select('-password').sort({ createdAt: -1 });
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

// Configure Multer for local storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public/images/products');
    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Sanitize filename and add timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, name + '_' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

// API endpoint to upload image locally
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('✅ File uploaded locally:', req.file.filename);
    
    // Return path relative to public directory
    // The frontend expects /images/products/filename
    const filePath = `/images/products/${req.file.filename}`;
    
    res.json({ success: true, filePath: filePath });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file', details: error.message });
  }
});

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

// Serve uploaded files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the React app
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  
  // The "catchall" handler: for any request that doesn't
  // match one above, send back React's index.html file.
  app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
