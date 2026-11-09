/**
 * The server on Lambda (src/lambda/README.md): the same Express app as Render,
 * behind API Gateway (HTTP API, payload 2.0), reached only through Render's
 * forwarder.
 *
 * Cold start: the app's settings come from Secrets Manager (`APP_SECRET_ARN`, a
 * JSON object) into process.env, RUNTIME=lambda, then server.ts is imported (it
 * connects MongoDB and starts nothing else in Lambda mode). Each request: the
 * forward secret is checked, the event runs through Express, and the socket
 * emits / cache busts it queued are sent to Render before the answer goes back.
 */
import { secretMatches } from '../server/socketRelay.ts';
import { flushRelay } from './relay.ts';
import { capAnswerSize, jsonResult, runHttpApiEvent } from './httpApi.ts';
import type { HttpApiEvent, HttpApiResult, NodeApp } from './httpApi.ts';

type LambdaContext = { callbackWaitsForEmptyEventLoop?: boolean; awsRequestId?: string };
type Log = Pick<Console, 'log' | 'warn' | 'error'>;

// Lambda sets these (or the function's configuration does): a secret never replaces them.
const KEPT = new Set(['RUNTIME', 'MODULE', 'APP_SECRET_ARN', 'PATH', 'TZ', 'LANG', 'LD_LIBRARY_PATH', 'NODE_PATH', 'NODE_OPTIONS', 'LAMBDA_TASK_ROOT', 'LAMBDA_RUNTIME_DIR']);
export const isKeptEnv = (name: string) => KEPT.has(name) || name.startsWith('AWS_') || name.startsWith('_');

/** Merge the secret's JSON into process.env (strings and numbers only); returns the names set. */
export function applySecretEnv(secretString: string, env: NodeJS.ProcessEnv = process.env, log: Log = console): string[] {
  const parsed: unknown = JSON.parse(secretString);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The app secret is not a JSON object');
  const set: string[] = [];
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isKeptEnv(name)) { log.warn(`[lambda] the app secret's ${name} is ignored (Lambda's own)`); continue; }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    env[name] = String(value);
    set.push(name);
  }
  return set;
}

/** APP_SECRET_ARN → process.env. Without it (a local run), the environment is used as it is. */
export async function loadAppSecret(log: Log = console): Promise<void> {
  const arn = process.env.APP_SECRET_ARN;
  if (!arn) { log.warn('[lambda] APP_SECRET_ARN not set: using the environment as it is'); return; }
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({});
  const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!out.SecretString) throw new Error(`Secret ${arn} has no value — run scripts/lambda-secrets.ts`);
  const names = applySecretEnv(out.SecretString, process.env, log);
  log.log(`[lambda] ${names.length} settings loaded from the app secret`);
}

/** server.ts in Lambda mode: the app, and a promise that it's connected to MongoDB. */
export async function loadServer(): Promise<{ app: NodeApp; ready: () => Promise<unknown> }> {
  process.env.RUNTIME = 'lambda';
  const server = await import('../../server.ts');
  return { app: server.app as unknown as NodeApp, ready: server.databaseReady };
}

type HandlerParts = {
  loadSecrets?: () => Promise<void>;
  loadApp?: () => Promise<{ app: NodeApp; ready: () => Promise<unknown> }>;
  flush?: () => Promise<void>;
  log?: Log;
};

export function createHandler({ loadSecrets = () => loadAppSecret(), loadApp = loadServer, flush = flushRelay, log = console }: HandlerParts = {}) {
  let secrets: Promise<void> | null = null;
  let server: Promise<{ app: NodeApp; ready: () => Promise<unknown> }> | null = null;

  return async function handler(event: HttpApiEvent, context: LambdaContext = {}): Promise<HttpApiResult> {
    context.callbackWaitsForEmptyEventLoop = false;
    const what = `${event.requestContext?.http?.method} ${event.rawPath}`;
    try {
      await (secrets ??= loadSecrets().catch((err) => { secrets = null; throw err; }));
    } catch (err) {
      log.error('[lambda] could not load the app secret:', err);
      return jsonResult(503, { error: 'The server is starting — please try again.' });
    }

    // Only Render's forwarder knows this; API Gateway's own URL answers nothing else.
    const given = event.headers?.['x-forward-secret'];
    if (!process.env.FORWARD_SECRET || !secretMatches(given, process.env.FORWARD_SECRET)) {
      return jsonResult(403, { error: 'Forbidden' });
    }

    let app: NodeApp;
    try {
      const loaded = await (server ??= loadApp());
      await loaded.ready();
      app = loaded.app;
    } catch (err) {
      log.error(`[lambda] not ready for ${what}:`, err);
      return jsonResult(503, { error: 'The server is busy — please try again.' });
    }

    try {
      return capAnswerSize(await runHttpApiEvent(app, event), log, what);
    } catch (err) {
      log.error(`[lambda] ${what} failed:`, err);
      return jsonResult(500, { error: 'Something went wrong on the server.' });
    } finally {
      // A frozen Lambda would drop them: Render gets the live updates first.
      await flush();
    }
  };
}

export const handler = createHandler();
