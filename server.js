import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import nodemailer from 'nodemailer';
import Product from './src/models/Product.js';
import Admin from './src/models/Admin.js';
import ContactSubmission from './src/models/ContactSubmission.js';
import Customer from './src/models/Customer.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// DEBUG ENDPOINT - REMOVE IN PRODUCTION
app.get('/api/debug/config', async (req, res) => {
  try {
    const adminCount = await Admin.countDocuments();
    const dbName = mongoose.connection.name;
    const host = mongoose.connection.host;
    
    // Check for specific user if provided
    let userCheck = null;
    if (req.query.username) {
      const user = await Admin.findOne({ username: req.query.username.toLowerCase() });
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
// const storage = multer.memoryStorage();
// const upload = multer({ storage: storage });

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
app.use(express.json({ limit: '50mb' })); // Increase limit for large payloads
app.use(cookieParser());

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
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
const verifyToken = (req, res, next) => {
  const token = req.cookies.adminToken;
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminId = decoded.adminId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
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
    
    // Find admin by username
    const admin = await Admin.findOne({ username: username.toLowerCase() });
    
    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    // Check if account is locked
    if (admin.isLocked()) {
      return res.status(423).json({ 
        success: false, 
        message: 'Account locked due to too many failed attempts. Try again in 15 minutes.' 
      });
    }
    
    // Verify password
    const isMatch = await admin.comparePassword(password);
    
    if (!isMatch) {
      // Increment login attempts
      await admin.incLoginAttempts();
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    // Reset login attempts on successful login
    if (admin.loginAttempts > 0) {
      await admin.resetLoginAttempts();
    }
    
    // Generate JWT
    const token = jwt.sign(
      { adminId: admin._id, username: admin.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Set HTTP-only cookie
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ 
      success: true, 
      message: 'Login successful',
      admin: { username: admin.username, email: admin.email }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
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
        const transporter = nodemailer.createTransporter({
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
    const { firstName, lastName, email, password, phone, company } = req.body;

    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ email });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create new customer
    const customer = new Customer({
      firstName,
      lastName,
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
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.status(201).json({ 
      success: true, 
      message: 'Registration successful',
      user: {
        id: customer._id,
        firstName: customer.firstName,
        lastName: customer.lastName,
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

    // Find customer
    const customer = await Customer.findOne({ email: email.toLowerCase() });
    if (!customer) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check if account is active
    if (customer.isActive === false) {
      return res.status(403).json({ message: 'Account is deactivated. Please contact support.' });
    }

    // Check if locked
    if (customer.isLocked()) {
      return res.status(423).json({ 
        message: 'Account locked due to too many failed attempts. Please try again in 15 minutes.' 
      });
    }

    // Verify password
    const isMatch = await customer.comparePassword(password);
    if (!isMatch) {
      await customer.incLoginAttempts();
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Reset login attempts on success
    await customer.resetLoginAttempts();

    // Capture and save IP address (keep last 3)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!customer.loginIps) customer.loginIps = [];
    customer.loginIps.push(ip);
    if (customer.loginIps.length > 3) {
      customer.loginIps.shift(); // Remove oldest
    }
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
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ 
      success: true, 
      message: 'Login successful',
      user: {
        id: customer._id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed. Please try again.' });
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
    const customer = await Customer.findById(req.customerId).select('-password');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json({
      id: customer._id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ message: 'Failed to fetch customer data' });
  }
});

// Customer Logout
app.post('/api/customer/logout', (req, res) => {
  res.clearCookie('customerToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.json({ message: 'Logged out successfully' });
});

// Admin: Get all customers
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
    const { firstName, lastName, email, password, phone, company, address, priceLevel } = req.body;

    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ email });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create new customer
    const customer = new Customer({
      firstName,
      lastName,
      email,
      password,
      phone,
      company,
      address,
      priceLevel: priceLevel || 1, // Default to level 1 if not provided
      isVerified: true // Admin created accounts are verified by default
    });

    await customer.save();

    res.status(201).json({ 
      success: true, 
      message: 'Customer created successfully',
      customer: {
        id: customer._id,
        firstName: customer.firstName,
        lastName: customer.lastName,
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
    const { firstName, lastName, email, password, phone, company, address, priceLevel } = req.body;
    const customerId = req.params.id;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Update fields
    customer.firstName = firstName || customer.firstName;
    customer.lastName = lastName || customer.lastName;
    customer.email = email || customer.email;
    customer.phone = phone || customer.phone;
    customer.company = company || customer.company;
    customer.address = address || customer.address;
    
    // Update price level if provided
    if (priceLevel !== undefined && priceLevel !== null) {
      customer.priceLevel = priceLevel;
    }

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
        firstName: customer.firstName,
        lastName: customer.lastName,
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

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

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
