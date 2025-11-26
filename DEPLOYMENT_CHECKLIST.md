# Easy Stones Website - Quick Deploy Checklist

## ✅ Pre-Deployment Checklist

- [x] Vercel configuration created (`vercel.json`)
- [x] Environment variables template created (`.env.example`)
- [x] API configuration centralized (`src/config/api.js`)
- [x] CORS updated for production
- [x] AdminPage using environment-aware API URLs

## 🚀 Deployment Steps

### 1. Deploy Backend (Railway)
1. Go to [railway.app](https://railway.app)
2. Import GitHub repository
3. Add environment variable: `PORT=3001`
4. Copy your Railway URL (e.g., `https://your-app.up.railway.app`)

### 2. Deploy Frontend (Vercel)
1. Go to [vercel.com](https://vercel.com)
2. Import GitHub repository
3. Add environment variable:
   - `VITE_API_URL` = Your Railway backend URL
4. Deploy!

### 3. Update Backend CORS
After deploying frontend, add your Vercel URL to Railway:
- Environment variable: `FRONTEND_URL` = Your Vercel URL

## 📝 Post-Deployment

- [ ] Test homepage loads
- [ ] Test product navigation
- [ ] Test admin panel access
- [ ] Test image upload
- [ ] Test product creation
- [ ] Verify all images load correctly

## 🔗 Your URLs
- Frontend: `https://_____.vercel.app`
- Backend: `https://_____.up.railway.app`
- Admin: `https://_____.vercel.app/admin`

## ⚠️ Important Notes

1. **File Persistence**: Railway's filesystem is ephemeral
   - Uploaded images will be lost on restart
   - Consider using cloud storage (S3, Cloudinary) for production

2. **Admin Security**: Admin panel is publicly accessible
   - Add authentication for production use

3. **Database**: Currently using file-based storage
   - Consider migrating to MongoDB/PostgreSQL for production

## 📚 Full Documentation
See `deployment-guide.md` for detailed instructions.
