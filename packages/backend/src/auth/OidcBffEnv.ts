import { neon } from '@neondatabase/serverless';
import { DEFAULT_LUTH_URL } from '@dinilmusick/gutts/auth';
import { createOAuthBff } from './OidcBff.js';

export interface CanonicalApplicationAuthEnvironment {
  APP_URL?: unknown;
  SYSTEM_DATABASE_URL?: unknown;
  SYSTEM_DATABASE_URL_2?: unknown;
  SYSTEM_DATABASE_URL_3?: unknown;
  LUTH_OAUTH_CLIENT_ID?: unknown;
  LUTH_OAUTH_CLIENT_SECRET?: unknown;
  LUTH_OAUTH_BFF_SECRET?: unknown;
  [key: string]: unknown;
}

/**
 * Single authoritative adapter from a verified application deployment to
 * Kloks' OAuth 2.1 BFF. App code must supply its compile-time canonical app ID
 * and trusted deployment bindings; never accept these from request JSON.
 */
export function createCanonicalApplicationOAuthBff(
  request: Request,
  env: CanonicalApplicationAuthEnvironment,
  applicationId: string,
) {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(applicationId)) throw new Error('INVALID_APP_ID');
  const origin = String(env.APP_URL || '').trim();
  const clientId = String(env.LUTH_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.LUTH_OAUTH_CLIENT_SECRET || '').trim();
  const secret = String(env.LUTH_OAUTH_BFF_SECRET || '');
  const dbUrl = String(env.SYSTEM_DATABASE_URL || env.SYSTEM_DATABASE_URL_2 || env.SYSTEM_DATABASE_URL_3 || '');
  if (!origin || !clientId || !clientSecret || secret.length < 32 || !dbUrl) {
    throw new Error('CANONICAL_APP_AUTH_NOT_PROVISIONED');
  }
  const verifiedOrigin = new URL(origin);
  if (verifiedOrigin.origin !== origin.replace(/\/$/, '') ||
      !['http:', 'https:'].includes(verifiedOrigin.protocol) ||
      new URL(request.url).origin !== verifiedOrigin.origin) {
    throw new Error('APPLICATION_ORIGIN_MISMATCH');
  }
  const sql = neon(dbUrl);
  return createOAuthBff({
    appId: applicationId,
    issuer: DEFAULT_LUTH_URL.replace(/\/$/, '') + '/api/auth',
    clientId,
    clientSecret,
    redirectUri: verifiedOrigin.origin + '/api/auth/oidc/callback',
    encryptionSecret: secret,
    database: {
      async query(statement, values) {
        // Kloks pins Neon HTTP driver 0.10.x: parameterized statements use
        // the callable query API; sql.query was introduced in Neon 1.x.
        const rows = await sql(statement, [...values]);
        return { rows: [...rows] };
      },
    },
  });
}
