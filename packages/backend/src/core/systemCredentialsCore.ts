/**
 * System-owned provider configuration reader.
 * Reads the existing ultrst-credentials record; user OAuth tokens live elsewhere.
 */

export type SystemQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: any[]; rowCount?: number }>;

export interface SystemCredentialsRecord {
  id: string;
  credentials: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface GoogleDriveOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
}

function parseCredentials(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

/** Keep the existing system credential table/schema; do not introduce app-specific env variables. */
export async function getSystemCredentialsRecord(
  queryDb: SystemQuery,
  targetId = 'system',
): Promise<SystemCredentialsRecord> {
  await queryDb(`
    CREATE TABLE IF NOT EXISTS public."ultrst-credentials" (
      id TEXT PRIMARY KEY,
      credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await queryDb(`
    ALTER TABLE public."ultrst-credentials"
    ADD COLUMN IF NOT EXISTS credentials JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await queryDb(`
    INSERT INTO public."ultrst-credentials" (id, credentials)
    VALUES ($1, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [targetId]);

  const result = await queryDb(
    'SELECT id, credentials, created_at, updated_at FROM public."ultrst-credentials" WHERE id = $1 LIMIT 1',
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return { id: targetId, credentials: {} };
  return {
    id: String(row.id || targetId),
    credentials: parseCredentials(row.credentials),
    ...(row.created_at ? { created_at: new Date(row.created_at).toISOString() } : {}),
    ...(row.updated_at ? { updated_at: new Date(row.updated_at).toISOString() } : {}),
  };
}

/**
 * Provider configuration is system-owned. This helper never reads a user's
 * Google tokens and is intended for server-side service operations only.
 */
export async function getGoogleDriveOAuthConfiguration(
  queryDb: SystemQuery,
): Promise<GoogleDriveOAuthConfiguration> {
  const record = await getSystemCredentialsRecord(queryDb, 'system');
  const root = record.credentials || {};
  const oauth = root.googleDriveOAuth || root.googleOAuth || {};
  const clientId = typeof oauth.clientId === 'string' ? oauth.clientId.trim() : '';
  const clientSecret = typeof oauth.clientSecret === 'string' ? oauth.clientSecret.trim() : '';
  const redirectUri = typeof oauth.redirectUri === 'string' ? oauth.redirectUri.trim() : '';
  const stateSecret = typeof oauth.stateSecret === 'string' && oauth.stateSecret.length >= 32
    ? oauth.stateSecret
    : clientSecret;

  const missing: string[] = [];
  if (!clientId) missing.push('client ID');
  if (!clientSecret) missing.push('client secret');
  if (!redirectUri) missing.push('redirect URI');
  if (!stateSecret || stateSecret.length < 32) missing.push('OAuth state signing secret (minimum 32 characters)');

  if (missing.length) {
    throw new Error(
      `[STORAGE_PROVIDER_CONFIGURATION_MISSING] Google Drive OAuth system configuration is incomplete: ${missing.join(', ')}. Configure system.ultrst-credentials.googleDriveOAuth.`,
    );
  }

  return { clientId, clientSecret, redirectUri, stateSecret };
}
