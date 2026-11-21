import { neon } from '@neondatabase/serverless';
import { DEFAULT_LUTH_URL } from '@dinilmusick/gutts/auth';
import { createOAuthBff } from './OidcBff.js';

/**
 * App-local OAuth client registration cache. This is NOT a trusted origins
 * table: any app independently creates its OAuth client through Luth's
 * anonymous RFC 7591 Dynamic Client Registration endpoint.
 */
export interface CanonicalApplicationAuthEnvironment {
  APP_URL?: unknown;
  SYSTEM_DATABASE_URL_1?: unknown;
  SYSTEM_DATABASE_URL_2?: unknown;
  SYSTEM_DATABASE_URL_3?: unknown;
  [key: string]: unknown;
}
type Registration = { client_id: string; encryption_secret: string };

function secret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
}
function redirectOf(request: Request, env: CanonicalApplicationAuthEnvironment): string {
  const raw = String(env.APP_URL || '').trim();
  if (!raw) throw new Error('APP_URL_UNAVAILABLE');
  const app = new URL(raw);
  if ((app.protocol !== 'https:' && !(app.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname))) ||
      app.origin !== raw.replace(/\/$/, '') ||
      new URL(request.url).origin !== app.origin) {
    throw new Error('APPLICATION_ORIGIN_MISMATCH');
  }
  return app.origin + '/api/auth/oidc/callback';
}
function connections(env: CanonicalApplicationAuthEnvironment): string[] {
  const values = [env.SYSTEM_DATABASE_URL_1, env.SYSTEM_DATABASE_URL_2,
    env.SYSTEM_DATABASE_URL_3];
  return values.filter((value): value is string =>
    typeof value === 'string' && !!value.trim()).map(value => value.trim());
}
async function selfRegister(appId: string, redirectUri: string): Promise<string> {
  const issuer = DEFAULT_LUTH_URL.replace(/\/$/, '');
  const response = await fetch(issuer + '/api/auth/oauth2/register', {
    // Cloudflare Workers (and some other runtimes) reject redirect: 'error'.
    // Manual redirects remain fail-closed: non-2xx responses are rejected below.
    method: 'POST', credentials: 'omit', redirect: 'manual', cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: appId,
      redirect_uris: [redirectUri],
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      scope: 'openid profile email offline_access',
    }),
  });
  if (!response.ok) throw new Error('LUTH_PUBLIC_OAUTH_REGISTRATION_DENIED');
  const value = await response.json() as Record<string, unknown>;
  if (typeof value.client_id !== 'string' || !value.client_id ||
      !Array.isArray(value.redirect_uris) ||
      value.redirect_uris.length !== 1 ||
      value.redirect_uris[0] !== redirectUri ||
      value.token_endpoint_auth_method !== 'none' ||
      value.client_secret != null) {
    throw new Error('LUTH_PUBLIC_OAUTH_REGISTRATION_INVALID');
  }
  return value.client_id;
}

/**
 * The app owns its opaque HttpOnly session and registered redirect URI.
 * Luth alone owns OAuth client issuance, login, consent and token validity.
 */
export function createCanonicalApplicationOAuthBff(
  request: Request,
  env: CanonicalApplicationAuthEnvironment,
  applicationId: string,
) {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(applicationId)) {
    throw new Error('INVALID_APP_ID');
  }
  const redirectUri = redirectOf(request, env);
  const databaseUrls = connections(env);
  if (!databaseUrls.length) throw new Error('SYSTEM_DATABASE_UNAVAILABLE');

  async function resolve(current: Request) {
    if (redirectOf(current, env) !== redirectUri) {
      throw new Error('APPLICATION_ORIGIN_MISMATCH');
    }
    let lastError: unknown;
    for (const url of databaseUrls) {
      let phase = 'read_registration';
      try {
        const sql = neon(url);
        let rows = [...await sql(
          'SELECT client_id,encryption_secret FROM public.kloks_oidc_registrations ' +
          'WHERE app_id=$1 AND redirect_uri=$2 LIMIT 2',
          [applicationId, redirectUri],
        )] as Registration[];
        if (!rows.length) {
          // Registration is open. Never query a trusted-origin or approved-app
          // list, and never require an operator to provision a client secret.
          phase = 'public_registration';
          const clientId = await selfRegister(applicationId, redirectUri);
          phase = 'persist_registration';
          await sql(
            'INSERT INTO public.kloks_oidc_registrations ' +
            '(app_id,redirect_uri,client_id,encryption_secret) VALUES ($1,$2,$3,$4) ' +
            'ON CONFLICT (app_id,redirect_uri) DO NOTHING',
            [applicationId, redirectUri, clientId, secret()],
          );
          phase = 'reload_registration';
          rows = [...await sql(
            'SELECT client_id,encryption_secret FROM public.kloks_oidc_registrations ' +
            'WHERE app_id=$1 AND redirect_uri=$2 LIMIT 2',
            [applicationId, redirectUri],
          )] as Registration[];
        }
        if (rows.length !== 1 || typeof rows[0]?.client_id !== 'string' ||
            typeof rows[0]?.encryption_secret !== 'string' ||
            rows[0].encryption_secret.length < 32) {
          throw new Error('OAUTH_CLIENT_REGISTRATION_INVALID');
        }
        phase = 'create_bff';
        return createOAuthBff({
          appId: applicationId,
          issuer: DEFAULT_LUTH_URL.replace(/\/$/, '') + '/api/auth',
          clientId: rows[0].client_id,
          redirectUri,
          encryptionSecret: rows[0].encryption_secret,
          database: {
            async query(statement, values) {
              const result = await sql(statement, [...values]);
              return { rows: [...result] };
            },
          },
        });
      } catch (error) {
        lastError = error;
        // Server-only diagnostic. Never log driver messages, connection strings,
        // user data, redirect URIs or client IDs.
        const info = error as { message?: unknown; code?: unknown } | null;
        const message = typeof info?.message === 'string' ? info.message : '';
        const code = /^[A-Z_]{4,90}$/.test(message) ? message : 'UNCLASSIFIED';
        const sqlstate = typeof info?.code === 'string' &&
          /^[A-Z0-9]{5}$/.test(info.code) ? info.code : 'UNKNOWN';
        console.error('[Kloks OAuth bootstrap failed]', { phase, code, sqlstate });
      }
    }
    throw new Error(lastError ? 'OAUTH_CLIENT_REGISTRATION_UNAVAILABLE' :
      'SYSTEM_DATABASE_UNAVAILABLE');
  }
  return {
    handle: async (current: Request) => (await resolve(current)).handle(current),
    getSession: async (current: Request) => (await resolve(current)).getSession(current),
    start: async (current: Request) => (await resolve(current)).start(current),
    callback: async (current: Request) => (await resolve(current)).callback(current),
    session: async (current: Request) => (await resolve(current)).session(current),
    signOut: async (current: Request) => (await resolve(current)).signOut(current),
  };
}
