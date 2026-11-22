# Technology Stack

Finalized 2026-11-22. This replaces the old `TECH_STACK.md` and `TECH_STACK_REVIEW.md`.
How and why each piece is used lives in `CLAUDE.md`; the move plans are in
`MIGRATION_NOTES.md` and `DB_MOVE_CHECKLIST.md`.

## Decisions (owner, 2026-11-22)

| Area | Decision |
|---|---|
| Database | **PostgreSQL on AWS RDS.** MongoDB is **retired after 2027-01-01**; until then it holds only what hasn't been cut over. Nothing writes to both. |
| Hosting | **Render is current; AWS Lambda is the target.** Render stays until Lambda is proven. |
| Email | **Amazon SES, with Gmail SMTP as the fallback**, once DNS access for easystones.com exists. Until then Gmail sends. |
| Mobile | **React Native with Expo** is in development, **alongside** the Capacitor app (owner, 2026-11-22). It starts with a first set of screens; the rest stay in the Capacitor shell until moved. Not Flutter or Rust. |
| Language | **TypeScript everywhere** (strict); the server runs `.ts` directly on Node 24. |
| Unused hosts | Vercel, Railway, Netlify and GitHub Pages are not used (config and guides removed). |

## Frontend
- **React 19**, **React Router 6**, **TypeScript**
- **Vite 8** (build and dev server) with **vite-plugin-pwa** (service worker)
- **Lucide React** icons; plain CSS (no CSS framework); our own shared form, calendar, pagination and picker components
- **Google Maps** (`@react-google-maps/api`) for the Route Planner and Team Location
- **zxing-wasm** (barcodes) and **Tesseract.js** (OCR) for the Selection Sheet tag scanner
- **SheetJS (xlsx)** for Excel, **pdf-lib** and **pdfjs-dist** for PDFs

## Backend
- **Node.js 24**, running TypeScript directly (`node server.ts`, erasable syntax only)
- **Express 5**, **Socket.io** (live updates, who's online), **Zod** (validation)
- **Multer** (uploads), **Sharp** (image resizing), **Nodemailer** (email transport)
- **express-rate-limit**, **compression**, **cors**, **cookie-parser**
- **Anthropic SDK** (receipt reading on Credit Card Receipts)

## Data
- **PostgreSQL on AWS RDS**, **Drizzle ORM** and Drizzle Kit migrations (`drizzle/`, applied with `npm run pg:migrate -- --apply`); RDS IAM-token login
- **MongoDB / Mongoose** — legacy, retired after 2027-01-01
- **Files:** S3 behind CloudFront through `src/services/fileStore.ts`. Old Cloudinary files keep working until nothing points there.

## Auth and security
- **JWT** in HTTP-only cookies; separate signing keys for staff setup sessions and the supplier portal
- **bcryptjs** password hashing; five-wrong-passwords lockout
- Per-role permission switches (Users & Roles); every route checks one

## Mobile (iOS and Android)
**React Native app (in development):**
- **React Native** with **Expo** (development builds, EAS Build), TypeScript
- Uses the same server API, permission rules and shared `src/utils/*` TypeScript rules as the website
- `location-health` becomes an Expo native module (Swift / Kotlin), so its work carries over
- First set of screens only: location tracking, check-in, deliveries, Route Planner (to confirm); everything else stays in Capacitor until moved

**Capacitor app (current, stays alongside):**
- **Capacitor 8** shell loading the live site (app name Easy Surfaces)
- Plugins: background geolocation, geolocation, camera, push notifications, keyboard, status bar, splash screen, app
- **`plugins/location-health`**: our own native plugin (Swift on iOS, Java on Android) for permission level, battery, Low Power Mode, significant-change relaunch and a durable point queue
- **Push:** Apple APNs now; Android needs FCM (not built)

## Infrastructure
- **Now:** Render (web service), AWS RDS, S3 + CloudFront, SES, Secrets Manager
- **Target:** AWS Lambda for the server (needs RDS Proxy or connection reuse, and EventBridge for scheduled jobs)
- **AWS infrastructure as code:** the separate `aws-infra` repo (CDK). No EC2.

## Testing and tooling
- **Vitest** (unit and route tests), **Testing Library** + **jsdom** (components)
- **PGlite** (in-memory Postgres) and **mongodb-memory-server** for database tests
- **Playwright** (end-to-end), **ESLint**, **tsc** typecheck
- Run: `npm test`, `npm run typecheck`, `npm run build`

## Not used
Flutter, Rust, Django, Aurora, EC2, Vercel, Railway, Netlify, GitHub Pages, Resend.
