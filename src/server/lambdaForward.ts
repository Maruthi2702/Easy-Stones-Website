/**
 * Render → Lambda: forwards the `/api/...` modules that have moved to Lambda on to
 * API Gateway, and streams the answer back untouched. The contract (what's sent,
 * what's never forwarded, what happens when Lambda can't be reached) is
 * src/lambda/README.md, "Render → Lambda".
 *
 *   parseLambdaRoutes(process.env.LAMBDA_ROUTES)   '/api/permits,!/api/permits/refresh'
 *   shouldForward(path, routes)                     prefix match, exclusions win
 *   createLambdaForward({ apiUrl, routes, secret, before: [apiLimiter] })
 *
 * Mounted in server.ts before compression, express.json and cookieParser, so the
 * request body is still unread and the response isn't wrapped by compression.
 * Server-only; Node built-ins only.
 */
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type LambdaRoutes = {
  /** Prefixes that go to Lambda. */
  include: string[];
  /** `!` entries: prefixes that stay on Render even inside an included one. */
  exclude: string[];
  /** Entries that aren't a path (no leading `/`), ignored — for a start-up warning. */
  invalid: string[];
};

/**
 * Never forwarded whatever LAMBDA_ROUTES says: the relay is how Lambda talks to
 * Render, so sending it to Lambda would loop.
 */
export const NEVER_FORWARD = ['/api/internal/relay'];

export const FORWARD_TIMEOUT_MS = 30_000;
/** Lambda's request limit is 6 MB (base64 and the event wrapper take the rest). */
export const MAX_FORWARD_BODY_BYTES = 5 * 1024 * 1024;
export const BUSY_MESSAGE = 'The server is busy — please try again.';

/** `connection`, `keep-alive`, … : about one hop, never passed on (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'trailers']);
const isHopByHop = (name: string) => HOP_BY_HOP.has(name) || name.startsWith('proxy-');

/** A prefix without its trailing slashes ('/api/permits/' is '/api/permits'). */
const normalisePrefix = (entry: string) => entry.length > 1 ? entry.replace(/\/+$/, '') || '/' : entry;

export function parseLambdaRoutes(spec: string | null | undefined): LambdaRoutes {
  const routes: LambdaRoutes = { include: [], exclude: [], invalid: [] };
  for (const raw of String(spec ?? '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const excluded = entry.startsWith('!');
    const path = (excluded ? entry.slice(1) : entry).trim();
    if (!path.startsWith('/')) { routes.invalid.push(entry); continue; }
    (excluded ? routes.exclude : routes.include).push(normalisePrefix(path));
  }
  return routes;
}

/** The path itself or the path followed by `/` — '/api/permits' never matches '/api/permitsx'. */
const underPrefix = (path: string, prefix: string) =>
  prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);

/**
 * Whether this path goes to Lambda. Path only (a query string is cut off),
 * case-sensitive, nothing decoded; an exclusion beats any inclusion.
 */
export function shouldForward(path: string, routes: LambdaRoutes): boolean {
  const queryAt = path.indexOf('?');
  const bare = queryAt === -1 ? path : path.slice(0, queryAt);
  if (NEVER_FORWARD.some((p) => underPrefix(bare, p))) return false;
  if (routes.exclude.some((p) => underPrefix(bare, p))) return false;
  return routes.include.some((p) => underPrefix(bare, p));
}

/** The body is small enough to forward, and its size is known up front. */
export function forwardableBody(headers: IncomingHttpHeaders, maxBodyBytes = MAX_FORWARD_BODY_BYTES): boolean {
  const length = headers['content-length'];
  if (length === undefined) return headers['transfer-encoding'] === undefined; // chunked with no length: no
  if (!/^\d+$/.test(length.trim())) return false;
  return Number(length) <= maxBodyBytes;
}

/**
 * Why the socket address is what's appended to x-forwarded-for:
 *
 * server.ts sets `trust proxy` to 1, so on Render Express's `req.ip` is worked out
 * from two things — the socket's remote address (Render's own proxy) and the
 * x-forwarded-for header that proxy sent ("…, <client>"). Trusting one hop means
 * "the socket is a proxy I trust; the address it says it got the request from (the
 * header's last entry) is the client". With no header, req.ip is the socket
 * address itself.
 *
 * Appending the socket address — what any proxy does (each appends the peer it
 * heard from) — gives Lambda Render's whole view in one header: the last entry is
 * Render's socket peer, everything before it is the header Render received. So on
 * Lambda, popping the last entry back off as the remote address (after dropping
 * an address API Gateway may have appended itself, `splitRenderForwardedFor`) and
 * running the same `trust proxy` 1 gives exactly Render's req.ip — including the
 * no-header case and a client that sends a spoofed x-forwarded-for of its own
 * (still ignored, as on Render). Appending req.ip instead would make Lambda's
 * answer depend on how many hops it trusted, and would lose the socket address.
 */
export function appendForwardedFor(incoming: string | string[] | undefined, socketAddress: string | undefined): string {
  const before = (Array.isArray(incoming) ? incoming.join(', ') : incoming ?? '').trim();
  const peer = socketAddress || 'unknown';
  return before ? `${before}, ${peer}` : peer;
}

/**
 * For the Lambda side: Render's view back out of the x-forwarded-for it received.
 * `apiGatewaySourceIp` (the event's requestContext.http.sourceIp) is dropped first
 * when API Gateway appended it after Render's entry. Returns the address to treat as
 * the socket's and the header to leave on the request, so `trust proxy` 1 on Lambda
 * computes the same req.ip as on Render. Dropping by equality is safe in production
 * because Render's entry is its internal proxy (a private address) and API Gateway's
 * is Render's public outbound address; they can't be the same.
 */
export function splitRenderForwardedFor(header: string | undefined, apiGatewaySourceIp?: string): { remoteAddress: string | undefined; forwardedFor: string | undefined } {
  const parts = String(header ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (apiGatewaySourceIp && parts.length > 1 && parts[parts.length - 1] === apiGatewaySourceIp) parts.pop();
  const remoteAddress = parts.pop();
  return { remoteAddress, forwardedFor: parts.length ? parts.join(', ') : undefined };
}

/** Every header but hop-by-hop ones (and those `connection` names) and host. */
export function outgoingHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const named = new Set(String(headers.connection ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === 'host' || isHopByHop(name) || named.has(name)) continue;
    out[name] = value;
  }
  return out;
}

/**
 * The upstream answer's headers from rawHeaders, so a header sent several times
 * (set-cookie above all) stays several, exactly as sent.
 */
function answerHeaders(upstream: IncomingMessage): Record<string, string | string[]> {
  const named = new Set(String(upstream.headers.connection ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
  const grouped = new Map<string, { name: string; values: string[] }>();
  const raw = upstream.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const lower = raw[i].toLowerCase();
    if (isHopByHop(lower) || named.has(lower)) continue;
    const entry = grouped.get(lower) ?? { name: raw[i], values: [] };
    entry.values.push(raw[i + 1]);
    grouped.set(lower, entry);
  }
  const out: Record<string, string | string[]> = {};
  for (const { name, values } of grouped.values()) out[name] = values.length > 1 ? values : values[0];
  return out;
}

export type LambdaForwardLog = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export type LambdaForwardOptions = {
  /** API Gateway base URL, no trailing slash (LAMBDA_API_URL). Empty = forward nothing. */
  apiUrl: string | null | undefined;
  /** parseLambdaRoutes(LAMBDA_ROUTES), or the spec itself. */
  routes: LambdaRoutes | string | null | undefined;
  /** FORWARD_SECRET, sent as x-forward-secret. */
  secret: string | null | undefined;
  /** Run first, only for requests that are forwarded (the /api rate limiter). */
  before?: RequestHandler[];
  timeoutMs?: number;
  maxBodyBytes?: number;
  log?: LambdaForwardLog;
};

const FALLBACK_WARN_EVERY_MS = 60_000;

/** Runs the `before` middlewares in turn; `done` only once the last one calls next(). */
function runBefore(chain: RequestHandler[], req: Request, res: Response, next: NextFunction, done: () => void) {
  let i = 0;
  const step = (err?: unknown) => {
    if (err !== undefined && err !== null && err !== 'route' && err !== 'router') return next(err);
    if (i >= chain.length) return done();
    const fn = chain[i++];
    try {
      const result = fn(req, res, step) as unknown;
      if (result && typeof (result as Promise<unknown>).then === 'function') (result as Promise<unknown>).catch(next);
    } catch (e) {
      next(e);
    }
  };
  step();
}

export function createLambdaForward(options: LambdaForwardOptions): RequestHandler {
  const {
    apiUrl, secret, before = [], timeoutMs = FORWARD_TIMEOUT_MS, maxBodyBytes = MAX_FORWARD_BODY_BYTES, log = console
  } = options;
  const routes = typeof options.routes === 'object' && options.routes !== null
    ? options.routes : parseLambdaRoutes(options.routes);
  const base = String(apiUrl ?? '').trim().replace(/\/+$/, '');

  if (!base || routes.include.length === 0) return (_req, _res, next) => next();

  const target = new URL(base);
  const client = target.protocol === 'https:' ? https : http;
  // Kept-alive sockets save a TLS handshake to API Gateway on every request.
  const agent = new client.Agent({ keepAlive: true, maxSockets: 64 });
  const basePath = target.pathname.replace(/\/+$/, '');
  let lastFallbackWarn = 0;

  const forward = (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    const readOnly = method === 'GET' || method === 'HEAD';
    const hasBody = req.headers['content-length'] !== undefined && Number(req.headers['content-length']) > 0;
    const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']
      ? req.headers['x-request-id'] : randomUUID();

    const headers = outgoingHeaders(req.headers);
    headers['x-forward-secret'] = String(secret ?? '');
    headers['x-forwarded-for'] = appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress);
    if (req.headers.host !== undefined) headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-proto'] = req.protocol;
    headers['x-request-id'] = requestId;

    let answered = false; // upstream's status line arrived
    let settled = false;  // we've given up on, or finished with, the upstream
    let upstreamRes: IncomingMessage | null = null;

    const upReq = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: req.method,
      path: `${basePath}${req.originalUrl}`,
      headers,
      agent
    });

    const timer = setTimeout(() => {
      fail(new Error(`no answer from Lambda within ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      res.off('close', onClientClose);
    };

    // Before any answer: GET/HEAD are served here instead; a write is never re-sent.
    function fail(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      upReq.destroy();
      if (answered) {
        upstreamRes?.destroy();
        log.error(`[lambda-forward] ${method} ${req.originalUrl} broke mid-answer (${requestId}):`, err.message);
        res.destroy(err);
        return;
      }
      req.unpipe(upReq);
      if (readOnly && !hasBody && !res.headersSent) {
        const now = Date.now();
        if (now - lastFallbackWarn >= FALLBACK_WARN_EVERY_MS) {
          lastFallbackWarn = now;
          log.warn(`[lambda-forward] Lambda unreachable (${err.message}); serving ${method} ${req.originalUrl} on Render. Further fallbacks for a minute aren't logged.`);
        }
        next();
        return;
      }
      log.error(`[lambda-forward] ${method} ${req.originalUrl} not delivered (${requestId}):`, err.message);
      req.resume(); // drain what's left so the connection can answer
      if (!res.headersSent) res.status(502).json({ error: BUSY_MESSAGE });
      else res.destroy(err);
    }

    // The browser went away: stop the upstream call too.
    function onClientClose() {
      if (settled || res.writableFinished) return;
      settled = true;
      cleanup();
      upReq.destroy();
      upstreamRes?.destroy();
    }
    res.on('close', onClientClose);

    upReq.on('error', (err) => fail(err));

    upReq.on('response', (upRes) => {
      if (settled) { upRes.destroy(); return; }
      answered = true;
      upstreamRes = upRes;
      const status = upRes.statusCode ?? 502;
      if (upRes.statusMessage) res.writeHead(status, upRes.statusMessage, answerHeaders(upRes));
      else res.writeHead(status, answerHeaders(upRes));
      upRes.on('error', (err) => fail(err));
      // Closed before its end: the answer was cut off (the client sees it cut off too).
      upRes.on('close', () => { if (!upRes.complete) fail(new Error('Lambda answer cut off')); });
      upRes.on('end', () => {
        if (settled) return;
        settled = true;
        cleanup();
      });
      upRes.pipe(res);
    });

    if (hasBody) req.pipe(upReq);
    else upReq.end();
  };

  return (req, res, next) => {
    const path = req.originalUrl;
    if (!shouldForward(path, routes)) return next();
    if (!forwardableBody(req.headers, maxBodyBytes)) return next(); // too big for Lambda: Render serves it
    runBefore(before, req, res, next, () => forward(req, res, next));
  };
}
