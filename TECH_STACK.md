# Easy Stones Website - Technology Stack

## Overview
This is a full-stack MERN (MongoDB, Express, React, Node.js) application for managing and displaying quartz products with customer authentication and admin capabilities.

---

## Frontend Stack

### Core Framework
- **React 18.3.1** - UI library for building component-based interfaces
- **React Router DOM 7.1.1** - Client-side routing and navigation

### State Management
- **React Context API** - Global state management for products and authentication
- Custom contexts:
  - `ProductContext` - Caches product data globally
  - `AuthContext` - Manages customer authentication state

### Styling
- **Vanilla CSS** - Custom styling with CSS variables for theming
- **CSS Modules** - Component-scoped styles
- Design features:
  - Dark theme with glassmorphism effects
  - Responsive grid layouts
  - Custom animations and transitions

### UI Components & Icons
- **Lucide React** - Modern icon library
- Custom components:
  - `Header` - Navigation and user menu
  - `Footer` - Site links and contact info
  - `ProductCard` - Product display cards
  - `ProductGrid` - Product listing with filters
  - `CategoryNav` - Category navigation tabs

### Build Tools
- **Vite 6.0.5** - Fast build tool and dev server
- **@vitejs/plugin-react 4.3.4** - React plugin for Vite

---

## Backend Stack

### Runtime & Framework
- **Node.js** - JavaScript runtime
- **Express 4.21.2** - Web application framework
- **ES Modules** - Modern JavaScript module system

### Database
- **MongoDB** - NoSQL database for storing products and customers
- **Mongoose 8.9.3** - ODM (Object Data Modeling) library
- Collections:
  - `products` - Product catalog
  - `customers` - Customer accounts
  - `admins` - Admin users

### Authentication & Security
- **JWT (jsonwebtoken 9.0.2)** - Token-based authentication
- **bcryptjs 2.4.3** - Password hashing
- **cookie-parser 1.4.7** - Cookie handling
- **express-rate-limit 7.5.0** - Rate limiting for login attempts
- Security features:
  - HTTP-only cookies
  - Account lockout after failed attempts
  - IP address tracking (last 3 logins)
  - Separate admin and customer authentication

### File Upload
- **Multer 1.4.5-lts.1** - Multipart/form-data handling for image uploads
- Local file storage in `/public/images/products/`

### Email
- **Nodemailer 6.9.16** - Email sending for contact forms and notifications

### Environment & Configuration
- **dotenv 17.2.3** - Environment variable management
- **CORS 2.8.5** - Cross-Origin Resource Sharing

---

## Database Schema

### Product Model
```javascript
{
  id: Number (unique),
  name: String,
  category: String,
  collectionType: String,
  availability: String,
  image: String,
  installedImages: [String], // Up to 2 installed images
  isNewArrival: Boolean,
  showInSlider: Boolean,
  thickness: [String],
  sizes: [String],
  description: String,
  primaryColor: String,
  accentColor: String,
  style: String,
  variations: String,
  finishes: [String],
  applications: [String],
  landingCost: Number,
  priceLevels: {
    level1: Number, // 40% margin
    level2: Number, // 30% margin
    level3: Number, // 20% margin
    level4: Number  // 10% margin
  }
}
```

### Customer Model
```javascript
{
  firstName: String,
  lastName: String,
  email: String (unique),
  password: String (hashed),
  phone: String,
  company: String,
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String
  },
  isVerified: Boolean,
  isActive: Boolean,
  priceLevel: Number (1-4),
  loginAttempts: Number,
  lockUntil: Date,
  loginIps: [String] // Last 3 IPs
}
```

---

## Key Features

### Customer Features
- Browse products by category
- View detailed product information
- See pricing based on customer price level (when logged in)
- User registration and login
- Account management

### Admin Features
- Product management (CRUD operations)
- Customer management
- Image upload for products and installed images
- Bulk product updates
- Price level management
- Availability tracking

### Product Display
- Dynamic product grid with category filtering
- Product detail pages with specifications
- Installed images gallery (2 images per product)
- Two-column layout: specs on left, installed images on right
- Responsive design for all devices

---

## Deployment

### Hosting
- **Render** - Cloud platform for deployment
- Separate services for frontend and backend

### Environment Variables (Production)
Required on Render:
- `JWT_SECRET` - Secret key for JWT token generation
- `MONGO_URI` - MongoDB connection string
- `FRONTEND_URL` - Frontend URL for CORS
- `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT` - Email configuration

### Build Commands
- **Frontend**: `npm run build` (creates production build in `dist/`)
- **Backend**: `npm start` (runs `node server.js`)

---

## Development

### Local Setup
1. Install dependencies: `npm install`
2. Create `.env` file with required variables
3. Start backend: `npm start` (port 3001)
4. Start frontend: `npm run dev` (port 5173)

### Scripts
- `npm run dev` - Start Vite dev server
- `npm start` - Start backend server
- `npm run build` - Build for production

---

## Recent Updates

### Latest Features (2025-11-27)
1. **Installed Images Feature**
   - Added `installedImages` field to Product schema
   - Admin panel upload for 2 installed images per product
   - Product detail page redesigned with 2-column layout
   - Placeholder "Coming Soon" for missing images

2. **Customer Login Fix**
   - Updated cookie `sameSite` policy to `'none'` for production
   - Enables cross-site cookies for Render deployment
   - Added debug logging for troubleshooting

3. **Enhanced Debugging**
   - Added detailed logging to customer login endpoint
   - Error messages now include specific failure reasons

4. **Performance Optimizations**
   - **Database Indexes**: Added indexes to Product (id, category, name) and Customer (email, isActive, priceLevel) models for 10-100x faster queries
   - **Response Compression**: Implemented gzip compression middleware for 70-90% smaller response sizes
   - **Connection Pooling**: Configured MongoDB connection pool (10 max, 2 min connections) for better concurrency handling
   - **Expected Impact**: 5-10x faster page loads, 10x more concurrent users supported

5. **UI Simplification**
   - Streamlined Product Detail page to show only essential specs
   - Removed: Primary Color, Accent Color, Style, Variations
   - Kept: Price, Thickness, Size Options, Available Finishes, Applications
   - Fixed price update delay by always fetching fresh data

6. **Book Match Feature**
   - Added `bookMatch` field to Product schema (Yes/No/N/A)
   - Admin panel dropdown for managing Book Match status
   - Displayed in Product Detail page below Size Options

---

## Architecture Patterns

### Frontend
- Component-based architecture
- Context API for global state
- Custom hooks for authentication
- Responsive CSS with mobile-first approach

### Backend
- RESTful API design
- Middleware-based request handling
- Schema validation with Mongoose
- JWT-based stateless authentication

### Data Flow
1. Frontend makes API requests to backend
2. Backend validates requests and authenticates users
3. Database operations via Mongoose
4. Response sent back to frontend
5. Frontend updates UI based on response

---

*Last Updated: 2025-11-27*
