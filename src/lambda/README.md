# The server on Lambda (phase 2a, 2026-11-08)

Owner's order (2026-11-08): the server moves to **AWS Lambda first, still on MongoDB**;
Render keeps the site and the Render link and **forwards `/api/...` to API Gateway**.
Postgres comes after, area by area. No EC2 of any kind. Lambdas run **outside the VPC**
while they only talk to MongoDB Atlas, Gmail and Google (no NAT).

```
browser ──► Render (server.ts) ──┬─ /api/<moved module>/… ──► API Gateway (HTTP API) ──► Lambda easy-surfaces-<env>-api-<module>
                                 │                                                          │  same Express app, RUNTIME=lambda
                                 ├─ everything else: served on Render as today              │
                                 └─ POST /api/internal/relay ◄── socket emits, cache busts ─┘
```

Render keeps: the site, Socket.IO (every live update and presence), the timers
(auto-submit, hold expiry, freight, permit pulls, SPS resume, keep-alive), the start-up
seeds/migrations, and every route not on the forward list. A module moves by adding its
prefix to `LAMBDA_ROUTES` on Render; taking it off moves it back. Nothing else changes.

## Contract between the parts

### Render → Lambda (the forwarder, `src/server/lambdaForward.ts`)

Render env: `LAMBDA_API_URL` (API Gateway base URL, no trailing slash), `LAMBDA_ROUTES`,
`FORWARD_SECRET`. Unset `LAMBDA_API_URL` or empty `LAMBDA_ROUTES` = forward nothing.

- `LAMBDA_ROUTES` is a comma list of path prefixes; a `!` entry excludes:
  `/api/permits,!/api/permits/refresh`. A prefix matches the path itself or the path
  followed by `/` (so `/api/permits` never matches `/api/permitsx`). Exclusions win.
  Matching is on the path only (no query string), case-sensitive, after decoding nothing.
- Mounted in server.ts **before** `compression`, `express.json` and `cookieParser`, so the
  request body is streamed untouched. The `/api` rate limiter still applies (it's passed
  in and run first).
- A request whose `content-length` is over **5 MB**, or chunked with no length, is **not
  forwarded** — Render serves it itself (Lambda's request limit is 6 MB).
- Sends: method, path + query exactly as received, every header except hop-by-hop
  (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-*`, `te`,
  `trailer`) and `host`, plus:
  - `x-forward-secret: <FORWARD_SECRET>`
  - `x-forwarded-for`: the incoming value with Render's view of the client (`req.ip`'s
    source, the socket address) appended — so Lambda's `req.ip` equals Render's `req.ip`
  - `x-forwarded-host`: the original `host`; `x-forwarded-proto`: `https` / `http` as Render saw it
  - `x-request-id`: incoming one or a new uuid
- Streams the answer back: status, every header (several `set-cookie` kept separate),
  body. Timeout 30 s (API Gateway's own limit is 30 s).
- Network failure / timeout before any answer: **GET/HEAD fall back to Render** (served
  locally, logged once a minute at most); any other method answers **502**
  `{ error: 'The server is busy — please try again.' }` (never re-sent: a write could
  land twice).

### Lambda → Render (the relay, `POST /api/internal/relay`, `src/server/socketRelay.ts`)

Lambda env: `RELAY_URL` (`https://<render host>/api/internal/relay`), `RELAY_SECRET`.
Render env: `RELAY_SECRET`. Unset secret on Render = the route answers 404.

- Header `x-relay-secret: <RELAY_SECRET>` (compared with `timingSafeEqual`), else 403.
- Body JSON (≤ 1 MB):
  ```json
  { "from": "lambda:permits",
    "messages": [
      { "type": "emit", "rooms": [], "event": "customer_update", "args": [{ "kind": "visit" }] },
      { "type": "emit", "rooms": ["location:Seattle"], "event": "delivery_update", "args": [] },
      { "type": "bust", "caches": ["customers", "users", "products"] }
    ] }
  ```
  `rooms: []` = `io.emit` (everyone); otherwise `io.to(rooms).emit`. Answers 204.
  Unknown message types / caches are ignored (logged), a malformed body is 400.
- Mounted **before** the `/api` rate limiter and auth. Never forwarded.

### The Lambda (`src/lambda/handler.ts`, `RUNTIME=lambda`)

Lambda env: `RUNTIME=lambda`, `MODULE`, `APP_SECRET_ARN` (Secrets Manager secret, a JSON
object of the app's env: `MONGO_URI`, `JWT_SECRET`, mail / Google / file-store keys …,
plus `FORWARD_SECRET`, `RELAY_SECRET`, `RELAY_URL`), merged into `process.env` at cold
start before the app is imported.

- The same Express app as Render. In Lambda mode server.ts connects to MongoDB and
  nothing else: no `listen`, no Socket.IO server, no timers, no start-up seeds or
  migrations, no keep-alive. `app.get('io')` is the relay (`emit`, `to(room|rooms)`,
  `in`, chained `to().to()`), which queues messages; the handler **awaits the flush
  before returning** (a frozen Lambda would drop them).
- The in-memory caches (`memoryCache`: customer dropdown / map, sales reps, products)
  are not used on Lambda (always read fresh); a bust on Lambda is relayed to Render.
- A request without the right `x-forward-secret` answers 403 (so API Gateway's own
  URL can't be used to go around Render). `host` is set from `x-forwarded-host` and
  `req.ip` / `req.protocol` match what Render saw.
- API Gateway HTTP API, payload format 2.0; binary answers (PDF, Excel, images) come
  back base64-encoded. Lambda answers are capped at 6 MB — a route that can send more
  stays excluded from the forward list until it sends a link instead.
- Bundle: `scripts/lambda-deploy.ts --module <name>` (esbuild, ESM, `index.mjs`
  exporting `handler`; native `sharp` for linux-arm64 included), uploaded to
  `easy-surfaces-<env>-api-<module>` (`LAMBDA_ENV`, dev by default).
  CloudFormation creates the function with placeholder code and leaves uploaded code
  alone (as the db-copy Lambda does).

As built (2026-11-08):

- `server.ts` exports `app` and `databaseReady()`; in Lambda mode it reads **no `.env`**
  (only the secret / the environment it's given), skips `dns.setServers`, the
  `process.on` crash handlers and the presence timer, and connects MongoDB only when
  the handler calls `databaseReady()` (a failed connect is tried again next request).
  Without `APP_SECRET_ARN` the handler uses the environment as it is (local runs).
  A secret never replaces `RUNTIME`, `MODULE`, `AWS_*`, `_*` or Lambda's own variables.
- `JOBS=off` (Render mode, e.g. a local test server): listen, but start none of the
  freight / holds / auto-submit / permit / SPS-resume / keep-alive jobs.
- `req.ip`: the handler runs `splitRenderForwardedFor` (src/server/lambdaForward.ts) on
  the event's `x-forwarded-for` and API Gateway's `sourceIp`: the socket address becomes
  Render's socket peer, `trust proxy` stays 1 as on Render.
- The adapter is our own (`src/lambda/httpApi.ts`, a real `IncomingMessage` /
  `ServerResponse`): text types (`text/*`, JSON, JS, XML, SVG, form) go back as text,
  anything else, or anything `content-encoding`d (gzip from `compression`), as base64;
  `set-cookie` lines go back as `cookies`. An answer over 6 MB becomes a 502 that says so.
- The relay merges every bust of a request into one message; a single message over
  Render's 1 MB is dropped (logged). No `RELAY_URL` / `RELAY_SECRET` = nothing sent.
- Permits on Lambda: `/meta`'s `running` comes from the database (a pull with no
  `finishedAt`, younger than 45 min — `src/permits/syncOnLambda.ts`), and `/refresh`
  answers 503.
- The zip: `index.mjs` (+ `.map`; set `NODE_OPTIONS=--enable-source-maps` for readable
  stacks), the two worker threads as `src/…/*.mjs`, the `public/` images the PDFs and
  mockups read, and `node_modules/` with sharp (linux-arm64), `@napi-rs/canvas`
  (linux-arm64; pdf.js needs it to read PDF text) and pdfjs-dist's two files.
  Playwright is a stub (the ERP scraper stays on Render). About 27 MB zipped,
  77 MB unzipped. sharp 0.32's binaries come from GitHub releases (cached in
  `~/.cache/easy-surfaces-lambda`, `LAMBDA_BUILD_CACHE`).
- Not the same on Lambda: delivery updates for a ticket with no branch reach only the
  all-branches room (Render reads the open rooms from Socket.IO), presence and
  `/api/admin/users/presence` are Render's, rate-limit counts are per instance (Render
  counts every forwarded request first), work a route leaves running after its answer
  (background geocoding, an SPS import's `runItems`) may be frozen with the instance.

### AWS (aws-infra, branch `feat/server-lambda`)

`api.modules` entry with external code: function `easy-surfaces-<env>-api-<module>`,
Node 24 arm64, 1024 MB, 29 s, outside the VPC, `APP_SECRET_ARN` → a Secrets Manager
secret `easy-surfaces/<env>/app` (CDK creates it as `{"placeholder":"<random>"}` and
never rewrites it; `scripts/lambda-secrets.ts` puts the whole JSON object), routes
`ANY /api/<module>` and `ANY /api/<module>/{proxy+}` (payload 2.0, no authorizer, no API
Gateway CORS — the app answers CORS itself). Config: `code: external` on the module
(`config/environments/dev.yaml`); until the first upload the function answers 503.
Deploy only the API stack: `npx cdk deploy easy-surfaces-dev-api --exclusively -c env=dev`.

## First module: Permits

`LAMBDA_ROUTES=/api/permits,!/api/permits/refresh` — `/refresh` starts a pull that runs
on after the answer (Render owns the pull and its "running" state).

## Testing without AWS

`scripts/lambda-local.ts` serves a handler as API Gateway would (payload 2.0) on a local
port; a local MongoDB copy (port 27027, never the live database) behind both a local
Render (`server.ts`, `LAMBDA_API_URL=http://localhost:<port>`) and the local Lambda.
