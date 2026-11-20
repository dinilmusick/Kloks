import { neon } from '@neondatabase/serverless';
import { DEFAULT_LUTH_URL } from '@dinilmusick/gutts/auth';
import { createOAuthBff } from './OidcBff.js';

/**
 * All runtime configuration for ULTRST deployments is reached using these
 * four canonical bindings. Application credentials are kept in the protected
 * system database, never passed as Worker/Vercel/local environment variables.
 */
export interface CanonicalApplicationAuthEnvironment {
  APP_URL?: unknown;
  SYSTEM_DATABASE_URL_1?: unknown;
  /** Transitional only: migrate to SYSTEM_DATABASE_URL_1 after full E2E. */
  SYSTEM_DATABASE_URL?: unknown;
  SYSTEM_DATABASE_URL_2?: unknown;
  SYSTEM_DATABASE_URL_3?: unknown;
  [key: string]: unknown;
}

interface VerifiedApplicationCredential {
  clientId: string;
  clientSecret: string;
  bffSecret: string;
}

/**
 * Resolve a *fresh* application credential on every request. A revoked Luth
 * client or removed origin stops new operations immediately, rather than
 * remaining authorized by a stale in-memory credential cache.
 */
export function createCanonicalApplicationOAuthBff(
  request: Request,
  env: CanonicalApplicationAuthEnvironment,
  applicationId: string,
) {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(applicationId)) {
    throw new Error('INVALID_APP_ID');
  }
  const origin = String(env.APP_URL || '').trim();
  const candidates = [
    env.SYSTEM_DATABASE_URL_1, env.SYSTEM_DATABASE_URL,
    env.SYSTEM_DATABASE_URL_2, env.SYSTEM_DATABASE_URL_3,
  ].filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map(value => value.trim());
  if (!origin || !candidates.length) throw new Error('CANONICAL_APP_AUTH_NOT_PROVISIONED');
  const verifiedOrigin = new URL(origin);
  if (verifiedOrigin.origin !== origin.replace(/\/$/, '') ||
      !['http:', 'https:'].includes(verifiedOrigin.protocol) ||
      new URL(request.url).origin !== verifiedOrigin.origin) {
    throw new Error('APPLICATION_ORIGIN_MISMATCH');
  }

  async function resolve(current: Request) {
    if (new URL(current.url).origin !== verifiedOrigin.origin) {
      throw new Error('APPLICATION_ORIGIN_MISMATCH');
    }
    const settingsKey = applicationId + '|' + verifiedOrigin.origin;
    const statement = `
      SELECT c."clientId" AS client_id,
        cred.credentials #> ARRAY['applicationOAuth', $3::text] AS settings
      FROM public."ultrst-apps" a
      JOIN public.luth_ecosystems e ON e.id = a.ecosystem_id
      JOIN public.luth_auth_origins o
        ON o.app_id = a.app_id AND o.ecosystem_id = a.ecosystem_id
      JOIN public."oauthClient" c
        ON c.metadata->>'appId' = a.app_id
        AND c.metadata->>'origin' = o.origin
      JOIN public."ultrst-credentials" cred ON cred.id = 'system'
      WHERE a.app_id = $1 AND a.status = 'active' AND e.status = 'active'
        AND o.origin = $2 AND o.enabled = true
        AND COALESCE(c.disabled, false) = false
      LIMIT 2
    `;
    let lastError: unknown;
    for (const dbUrl of candidates) {
      const sql = neon(dbUrl);
      let rows: Record<string, any>[];
      try {
        rows = [...await sql.query(statement, [applicationId, verifiedOrigin.origin, settingsKey])];
      } catch (error) {
        lastError = error;
        continue; // Only transport/database errors may fail over to a backup.
      }
      if (rows.length !== 1) throw new Error('CANONICAL_APP_AUTH_NOT_PROVISIONED');
      const raw = rows[0].settings;
      const credential: Partial<VerifiedApplicationCredential> =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      if (typeof credential.clientId !== 'string' ||
          typeof credential.clientSecret !== 'string' ||
          typeof credential.bffSecret !== 'string' ||
          credential.bffSecret.length < 32 ||
          credential.clientId !== rows[0].client_id ||
          !credential.clientSecret) {
        throw new Error('CANONICAL_APP_AUTH_NOT_PROVISIONED');
      }
      return createOAuthBff({
        appId: applicationId,
        issuer: DEFAULT_LUTH_URL.replace(/\/$/, '') + '/api/auth',
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        redirectUri: verifiedOrigin.origin + '/api/auth/oidc/callback',
        encryptionSecret: credential.bffSecret,
        database: {
          async query(query, values) {
            const result = await sql.query(query, [...values]);
            return { rows: [...result] };
          },
        },
      });
    }
    // Never return a browser-visible credential, database URL, or driver error.
    throw new Error(lastError ? 'SYSTEM_DATABASE_UNAVAILABLE' : 'CANONICAL_APP_AUTH_NOT_PROVISIONED');
  }

  return {
    handle: async (current: Request) => (await resolve(current)).handle(current),
    getSession: async (current: Request) => (await resolve(current)).getSession(current),
    configuration: async (current: Request) => (await resolve(current)).configuration(current),
    start: async (current: Request) => (await resolve(current)).start(current),
    callback: async (current: Request) => (await resolve(current)).callback(current),
    session: async (current: Request) => (await resolve(current)).session(current),
    signOut: async (current: Request) => (await resolve(current)).signOut(current),
  };
}
