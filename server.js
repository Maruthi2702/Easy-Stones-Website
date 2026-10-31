// Render's Start Command is `node server.js` (set in the Render dashboard, which
// overrides render.yaml's `node server.ts`). Since the TypeScript conversion the
// server is server.ts, and every deploy failed with "Cannot find module
// …/server.js" (2026-10-31). This only loads it. Delete this file once Render's
// Start Command is `npm start` (or `node server.ts`).
import './server.ts';
