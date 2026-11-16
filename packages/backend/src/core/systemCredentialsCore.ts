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
  allowedReturnOrigins: string[];
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

  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error('[STORAGE_PROVIDER_CONFIGURATION_INVALID] Google Drive OAuth redirect URI must be an absolute URL.');
  }
  if (parsedRedirect.protocol !== 'https:' && parsedRedirect.hostname !== 'localhost') {
    throw new Error('[STORAGE_PROVIDER_CONFIGURATION_INVALID] Google Drive OAuth redirect URI must use HTTPS (localhost is allowed for development).');
  }

  const allowedReturnOrigins = Array.isArray(oauth.allowedReturnOrigins)
    ? oauth.allowedReturnOrigins.flatMap((value: unknown) => {
        if (typeof value !== 'string') return [];
        try {
          const url = new URL(value.trim());
          if (url.protocol !== 'https:' && url.hostname !== 'localhost') return [];
          return [url.origin];
        } catch {
          return [];
        }
      })
    : [];

  return { clientId, clientSecret, redirectUri, stateSecret, allowedReturnOrigins };
}

/**
 * System-owned wrapping key for user-scoped storage provider secrets.
 * It is stored only in the canonical system.ultrst-credentials record and
 * is never included in provider capability or user connection projections.
 */
export async function getOrCreateStorageConnectionEncryptionKey(
  queryDb: SystemQuery,
): Promise<string> {
  const record = await getSystemCredentialsRecord(queryDb, 'system');
  const root = record.credentials || {};
  const storage = root.storageConnections && typeof root.storageConnections === 'object'
    ? root.storageConnections
    : {};
  const current = typeof storage.encryptionKey === 'string' ? storage.encryptionKey.trim() : '';
  if (current.length >= 43) return current;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const generated = btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
  const credentials = {
    ...root,
    storageConnections: {
      ...storage,
      encryptionKey: generated,
      encryptionKeyVersion: 1,
    },
  };

  // Compare-and-set so two first-time connection requests cannot each encrypt
  // data with a different key and then overwrite the winner's system secret.
  await queryDb(
    `UPDATE public."ultrst-credentials"
     SET credentials = $1::jsonb, updated_at = NOW()
     WHERE id = $2
       AND NULLIF(credentials #>> '{storageConnections,encryptionKey}', '') IS NULL`,
    [JSON.stringify(credentials), 'system'],
  );
  const refreshed = await getSystemCredentialsRecord(queryDb, 'system');
  const persisted = refreshed.credentials?.storageConnections?.encryptionKey;
  if (typeof persisted !== 'string' || persisted.trim().length < 43) {
    throw new Error('[STORAGE_SECRET_CONFIGURATION_UNAVAILABLE] Unable to resolve the canonical storage encryption key.');
  }
  return persisted.trim();
}
