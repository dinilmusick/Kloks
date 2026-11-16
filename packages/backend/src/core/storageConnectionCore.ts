/**
 * @file storageConnectionCore.ts
 * @description Fetch-native user storage connection registry.
 *
 * User-owned connection records remain compatible with the existing
 * app_profiles.srkl.storage_connections shape. Secrets are read only by
 * server-side operations; all list/create/test results use an allow-list
 * projection with opaque connection IDs.
 */

import { authorizeB2, b2ListBuckets } from '../storage/B2DirectClient.js';
import {
  GOOGLE_DRIVE_WORKSPACE_SCOPE,
  GoogleDriveWorkspaceService,
  type GoogleDriveWorkspaceFolder,
  type GoogleDriveWorkspaceTokens,
} from '../storage/GoogleDriveWorkspaceService.js';
import { queryUnifiedDb } from './unifiedDb.js';

export type StorageProviderId = 'backblaze_b2' | 'google_drive';

export interface StorageProviderCapability {
  id: StorageProviderId;
  displayName: string;
  enabled: boolean;
  availabilityReason?: string;
  canSelectExistingConnection: boolean;
  canCreateConnection: boolean;
  requiredConfigurationFields: string[];
  authorizationMode: 'application_key' | 'oauth2';
  discoveryCapabilities: {
    accounts: boolean;
    buckets: boolean;
    folders: boolean;
  };
}

export interface PublicStorageConnection {
  id: string;
  provider: string;
  label: string;
  role?: 'primary' | 'redundant_clone';
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  testedAt?: string;
  testStatus?: string;
  latencyMs?: number;
  b2BucketName?: string;
  bucketName?: string;
  b2Region?: string;
  b2Endpoint?: string;
  googleEmail?: string;
  googleAccountId?: string;
  googleRootFolderId?: string;
  googleRootFolderName?: string;
}

type StorageQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, any>> }>;

const DEFAULT_QUERY: StorageQuery = (sql, params) => queryUnifiedDb(sql, params);

const PUBLIC_FIELDS = [
  'id',
  'provider',
  'label',
  'role',
  'enabled',
  'createdAt',
  'updatedAt',
  'testedAt',
  'testStatus',
  'latencyMs',
  'b2BucketName',
  'bucketName',
  'b2Region',
  'b2Endpoint',
  'googleEmail',
  'googleAccountId',
  'googleRootFolderId',
  'googleRootFolderName',
] as const;

function parseProfiles(value: unknown): Record<string, any> {
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

function connectionCollections(profiles: Record<string, any>): any[][] {
  const collections: any[][] = [];
  const srklConnections = profiles.srkl?.storage_connections;
  if (Array.isArray(srklConnections)) collections.push(srklConnections);

  for (const [key, value] of Object.entries(profiles)) {
    if (key === 'srkl' || !value || typeof value !== 'object') continue;
    const connections = (value as Record<string, any>).storage_connections;
    if (Array.isArray(connections)) collections.push(connections);
  }
  return collections;
}

export function toPublicStorageConnection(raw: Record<string, any>): PublicStorageConnection | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.provider !== 'string') return null;
  const safe: Record<string, unknown> = {};
  for (const key of PUBLIC_FIELDS) {
    const value = raw[key];
    if (value !== undefined && value !== null) safe[key] = value;
  }
  safe.label = String(raw.label || raw.name || raw.id);
  safe.enabled = raw.enabled !== false;
  return safe as unknown as PublicStorageConnection;
}

function deduplicateRawConnections(items: any[]): any[] {
  const byId = new Map<string, any>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? { ...existing, ...item, id: existing.id } : item);
  }
  return [...byId.values()];
}

async function findUserRecord(userId: string, query: StorageQuery): Promise<{
  id: string;
  profiles: Record<string, any>;
  source: 'ultrst-users' | 'srkl_application_profiles';
} | null> {
  if (!userId?.trim()) return null;

  try {
    const result = await query(
      'SELECT id, app_profiles FROM "ultrst-users" WHERE id = $1 OR email = $1 LIMIT 1',
      [userId],
    );
    if (result.rows[0]) {
      return {
        id: String(result.rows[0].id),
        profiles: parseProfiles(result.rows[0].app_profiles),
        source: 'ultrst-users',
      };
    }
  } catch {
    // Some older installations have the SRKL profile table before the
    // shared user profile is available. Keep that record shape readable.
  }

  try {
    const result = await query(
      'SELECT id, app_profiles FROM "srkl_application_profiles" WHERE id = $1 OR email = $1 LIMIT 1',
      [userId],
    );
    if (result.rows[0]) {
      return {
        id: String(result.rows[0].id),
        profiles: parseProfiles(result.rows[0].app_profiles),
        source: 'srkl_application_profiles',
      };
    }
  } catch {
    // SRKL is optional for applications that use the shared storage service.
  }
  return null;
}

async function mergeLegacySrklConnections(
  userId: string,
  profiles: Record<string, any>,
  query: StorageQuery,
): Promise<any[]> {
  const local = connectionCollections(profiles).flat();
  try {
    const result = await query(
      'SELECT app_profiles FROM "srkl_application_profiles" WHERE id = $1 LIMIT 1',
      [userId],
    );
    if (result.rows[0]) {
      const legacyProfiles = parseProfiles(result.rows[0].app_profiles);
      local.push(...(Array.isArray(legacyProfiles.srkl?.storage_connections)
        ? legacyProfiles.srkl.storage_connections
        : []));
    }
  } catch {
    // Legacy table is intentionally optional after profile migration.
  }
  return deduplicateRawConnections(local);
}

/** Internal server-only connection resolution for storage engines; never expose through HTTP. */
export async function listUserStorageConnectionsWithSecrets(
  userId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<Record<string, any>[]> {
  const record = await findUserRecord(userId, query);
  if (!record) return [];
  return mergeLegacySrklConnections(record.id, record.profiles, query);
}

async function persistStorageConnectionCollection(
  userId: string,
  connections: Record<string, any>[],
  query: StorageQuery,
): Promise<void> {
  const record = await findUserRecord(userId, query);
  if (!record) throw new Error('A canonical user profile was not found for this storage connection.');
  const profiles = record.profiles;
  if (!profiles.srkl || typeof profiles.srkl !== 'object') profiles.srkl = {};
  profiles.srkl.storage_connections = connections;

  const table = record.source === 'ultrst-users' ? '"ultrst-users"' : '"srkl_application_profiles"';
  await query(
    `UPDATE ${table} SET app_profiles = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(profiles), record.id],
  );
  if (record.source === 'ultrst-users') {
    try {
      const legacy = await query(
        'SELECT app_profiles FROM "srkl_application_profiles" WHERE id = $1 LIMIT 1',
        [record.id],
      );
      if (legacy.rows[0]) {
        const legacyProfiles = parseProfiles(legacy.rows[0].app_profiles);
        if (!legacyProfiles.srkl || typeof legacyProfiles.srkl !== 'object') legacyProfiles.srkl = {};
        legacyProfiles.srkl.storage_connections = connections;
        await query(
          'UPDATE "srkl_application_profiles" SET app_profiles = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(legacyProfiles), record.id],
        );
      }
    } catch {
      // Older profiles without the compatibility table remain valid.
    }
  }
}

/** Set the primary marker without changing an existing workspace's explicit association. */
export async function setPrimaryUserStorageConnection(
  userId: string,
  connectionId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<PublicStorageConnection[]> {
  const connections = await listUserStorageConnectionsWithSecrets(userId, query);
  if (!connections.some((connection) => connection.id === connectionId)) {
    throw new Error('Storage connection was not found for this user.');
  }
  const updated = connections.map((connection) => ({
    ...connection,
    role: connection.id === connectionId ? 'primary' : 'redundant_clone',
  }));
  await persistStorageConnectionCollection(userId, updated, query);
  return updated.map(toPublicStorageConnection).filter((item): item is PublicStorageConnection => Boolean(item));
}

/** Delete only unreferenced connections; workspace associations must never become dangling. */
export async function deleteUserStorageConnection(
  userId: string,
  connectionId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<PublicStorageConnection[]> {
  const record = await findUserRecord(userId, query);
  if (!record) throw new Error('User profile was not found.');
  const connections = await mergeLegacySrklConnections(record.id, record.profiles, query);
  if (!connections.some((connection) => connection.id === connectionId)) {
    throw new Error('Storage connection was not found for this user.');
  }

  const referenced = Object.entries(record.profiles).some(([appId, profile]) =>
    appId !== 'srkl'
    && profile && typeof profile === 'object'
    && Array.isArray((profile as any).workspaces)
    && (profile as any).workspaces.some((workspace: any) => workspace.storageConnectionId === connectionId),
  );
  const srklWorkspaces = record.profiles.srkl?.workspaces;
  const srklReferenced = Array.isArray(srklWorkspaces)
    && srklWorkspaces.some((workspace: any) => workspace.storageConnectionId === connectionId);
  if (referenced || srklReferenced) {
    throw new Error('This storage connection is associated with a workspace. Change the workspace storage before deleting the connection.');
  }

  let updated = connections.filter((connection) => connection.id !== connectionId);
  if (!updated.some((connection) => connection.role === 'primary') && updated.length > 0) {
    updated = updated.map((connection, index) => ({
      ...connection,
      role: index === 0 ? 'primary' : 'redundant_clone',
    }));
  }
  await persistStorageConnectionCollection(userId, updated, query);
  return updated.map(toPublicStorageConnection).filter((item): item is PublicStorageConnection => Boolean(item));
}

/** Browser-safe list of all existing connections owned by a verified user. */
export async function listUserStorageConnections(
  userId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<PublicStorageConnection[]> {
  const record = await findUserRecord(userId, query);
  if (!record) return [];
  const raw = await mergeLegacySrklConnections(record.id, record.profiles, query);
  return raw
    .map(toPublicStorageConnection)
    .filter((connection): connection is PublicStorageConnection => Boolean(connection));
}

/** Server-only credential resolver. Never return this object from an HTTP API. */
export async function resolveUserStorageConnectionSecret(
  userId: string,
  connectionId?: string,
  query: StorageQuery = DEFAULT_QUERY,
  provider?: string,
): Promise<Record<string, any> | null> {
  const record = await findUserRecord(userId, query);
  if (!record) return null;
  const raw = await mergeLegacySrklConnections(record.id, record.profiles, query);
  const eligible = provider ? raw.filter((item) => item.provider === provider) : raw;
  if (connectionId) return eligible.find((item) => item.id === connectionId) || null;
  return eligible.find((item) => item.role === 'primary' && item.enabled !== false)
    || eligible.find((item) => item.enabled !== false)
    || null;
}

async function persistStorageConnection(
  userId: string,
  connection: Record<string, any>,
  query: StorageQuery,
): Promise<void> {
  const record = await findUserRecord(userId, query);
  if (!record) throw new Error('A canonical user profile was not found for this storage connection.');

  const profiles = record.profiles;
  if (!profiles.srkl || typeof profiles.srkl !== 'object') profiles.srkl = {};
  const connections = Array.isArray(profiles.srkl.storage_connections)
    ? profiles.srkl.storage_connections
    : [];

  const existingIndex = connections.findIndex((item: any) => item?.id === connection.id);
  if (existingIndex >= 0) {
    connections[existingIndex] = { ...connections[existingIndex], ...connection };
  } else {
    connections.push(connection);
  }
  profiles.srkl.storage_connections = connections;

  const table = record.source === 'ultrst-users' ? '"ultrst-users"' : '"srkl_application_profiles"';
  await query(
    `UPDATE ${table} SET app_profiles = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(profiles), record.id],
  );

  // Keep the former SRKL profile mirror synchronized while deployments are
  // migrating to ultrst-users. Failure here is not hidden for existing rows:
  // callers must not be told the connection is available if SRKL still reads
  // an outdated mirror.
  if (record.source === 'ultrst-users') {
    try {
      const legacy = await query(
        'SELECT app_profiles FROM "srkl_application_profiles" WHERE id = $1 LIMIT 1',
        [record.id],
      );
      if (legacy.rows[0]) {
        const legacyProfiles = parseProfiles(legacy.rows[0].app_profiles);
        if (!legacyProfiles.srkl || typeof legacyProfiles.srkl !== 'object') legacyProfiles.srkl = {};
        const legacyConnections = Array.isArray(legacyProfiles.srkl.storage_connections)
          ? legacyProfiles.srkl.storage_connections
          : [];
        const index = legacyConnections.findIndex((item: any) => item?.id === connection.id);
        if (index >= 0) legacyConnections[index] = { ...legacyConnections[index], ...connection };
        else legacyConnections.push(connection);
        legacyProfiles.srkl.storage_connections = legacyConnections;
        await query(
          'UPDATE "srkl_application_profiles" SET app_profiles = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(legacyProfiles), record.id],
        );
      }
    } catch {
      // Newer installations may no longer have the compatibility table.
    }
  }
}

export async function testBackblazeCredentials(
  keyId: string,
  applicationKey: string,
): Promise<{ success: boolean; accountId?: string; buckets: Array<{ id: string; name: string; type?: string }>; error?: string }> {
  const normalizedKeyId = String(keyId || '').trim();
  const normalizedApplicationKey = String(applicationKey || '').trim();
  if (!normalizedKeyId || !normalizedApplicationKey) {
    return { success: false, buckets: [], error: 'Backblaze B2 Key ID and Application Key are required.' };
  }

  try {
    const auth = await authorizeB2(normalizedKeyId, normalizedApplicationKey);
    const buckets = await b2ListBuckets(normalizedKeyId, normalizedApplicationKey);
    return {
      success: true,
      accountId: auth.accountId,
      buckets: buckets.map((bucket: any) => ({
        id: String(bucket.bucketId || ''),
        name: String(bucket.bucketName || ''),
        type: typeof bucket.bucketType === 'string' ? bucket.bucketType : undefined,
      })).filter((bucket: any) => bucket.name),
    };
  } catch (error) {
    return {
      success: false,
      buckets: [],
      error: error instanceof Error ? error.message : 'Backblaze B2 credential validation failed.',
    };
  }
}

/** Validate credentials and bucket access before persisting the user-owned connection. */
export async function createBackblazeStorageConnection(
  input: {
    userId: string;
    label?: string;
    keyId: string;
    applicationKey: string;
    bucketName: string;
    region?: string;
    endpoint?: string;
  },
  query: StorageQuery = DEFAULT_QUERY,
): Promise<PublicStorageConnection> {
  const userId = String(input.userId || '').trim();
  const keyId = String(input.keyId || '').trim();
  const applicationKey = String(input.applicationKey || '').trim();
  const bucketName = String(input.bucketName || '').trim();
  if (!userId || !keyId || !applicationKey || !bucketName) {
    throw new Error('A user, B2 Key ID, Application Key, and bucket are required.');
  }

  const test = await testBackblazeCredentials(keyId, applicationKey);
  if (!test.success) throw new Error(test.error || 'Backblaze B2 credential validation failed.');
  const selectedBucket = test.buckets.find((bucket) => bucket.name === bucketName);
  if (!selectedBucket) throw new Error('The selected Backblaze bucket is not available to these credentials.');

  const now = new Date().toISOString();
  const connection = {
    id: `conn_b2_${crypto.randomUUID()}`,
    provider: 'backblaze_b2',
    label: String(input.label || `Backblaze B2 — ${bucketName}`).trim(),
    role: 'redundant_clone',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    testedAt: now,
    testStatus: 'ok',
    b2KeyId: keyId,
    b2ApplicationKey: applicationKey,
    b2BucketName: bucketName,
    bucketName,
    b2Region: String(input.region || 'us-west-004').trim(),
    b2Endpoint: String(input.endpoint || 's3.us-west-004.backblazeb2.com').trim(),
    providerAccountId: test.accountId,
  };

  const record = await findUserRecord(userId, query);
  if (!record) throw new Error('A canonical user profile was not found for this storage connection.');
  const currentConnections = await mergeLegacySrklConnections(record.id, record.profiles, query);
  const duplicate = currentConnections.find((item) =>
    item.provider === 'backblaze_b2'
    && String(item.b2KeyId || item.keyId || '') === keyId
    && String(item.b2BucketName || item.bucketName || '') === bucketName,
  );
  if (duplicate) return toPublicStorageConnection(duplicate)!;

  connection.role = currentConnections.length === 0 ? 'primary' : 'redundant_clone';
  await persistStorageConnection(record.id, connection, query);
  return toPublicStorageConnection(connection)!;
}

/** List buckets for a saved connection without returning its credentials. */
export async function listBackblazeBucketsForConnection(
  userId: string,
  connectionId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<Array<{ id: string; name: string; type?: string }>> {
  const connection = await resolveUserStorageConnectionSecret(userId, connectionId, query);
  if (!connection || connection.provider !== 'backblaze_b2') {
    throw new Error('Backblaze B2 storage connection was not found for this user.');
  }
  const keyId = String(connection.b2KeyId || connection.keyId || connection.accessKeyId || '').trim();
  const applicationKey = String(connection.b2ApplicationKey || connection.applicationKey || connection.appKey || connection.secretAccessKey || '').trim();
  if (!keyId || !applicationKey) throw new Error('The saved Backblaze connection is missing server-side credentials.');

  const result = await testBackblazeCredentials(keyId, applicationKey);
  if (!result.success) throw new Error(result.error || 'Backblaze B2 bucket discovery failed.');
  return result.buckets;
}

export interface GoogleDriveSystemOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
  allowedReturnOrigins: string[];
}

/** Resolve system-owned Google OAuth configuration from the canonical system credential record. */
export async function getSystemGoogleOAuthConfiguration(
  query: StorageQuery = DEFAULT_QUERY,
): Promise<GoogleDriveSystemOAuthConfiguration> {
  const result = await query(
    'SELECT credentials FROM public."ultrst-credentials" WHERE id = $1 LIMIT 1',
    ['system'],
  );
  const raw = result.rows[0]?.credentials;
  const credentials = parseProfiles(raw);
  const oauth = credentials.googleDriveOAuth || credentials.googleOAuth || {};

  const clientId = String(oauth.clientId || '').trim();
  const clientSecret = String(oauth.clientSecret || '').trim();
  const redirectUri = String(oauth.redirectUri || '').trim();
  const stateSecret = String(oauth.stateSecret || clientSecret || '').trim();
  const allowedReturnOrigins = Array.isArray(oauth.allowedReturnOrigins)
    ? oauth.allowedReturnOrigins
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => {
          try { return new URL(value.trim()).origin; } catch { return ''; }
        })
        .filter(Boolean)
    : [];

  const missing: string[] = [];
  if (!clientId) missing.push('clientId');
  if (!clientSecret) missing.push('clientSecret');
  if (!redirectUri) missing.push('redirectUri');
  if (stateSecret.length < 32) missing.push('stateSecret (or clientSecret of at least 32 characters)');

  if (missing.length > 0) {
    throw new Error(
      `Google Drive OAuth system configuration is incomplete. Configure ${missing.join(', ')} in the system-owned ultrst-credentials record (id="system").`,
    );
  }

  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error('Google Drive OAuth system configuration has an invalid redirectUri.');
  }
  if (parsedRedirect.protocol !== 'https:' && parsedRedirect.hostname !== 'localhost') {
    throw new Error('Google Drive OAuth redirectUri must use HTTPS (localhost is permitted for development).');
  }

  return { clientId, clientSecret, redirectUri, stateSecret, allowedReturnOrigins };
}

/** Only capability metadata is exposed; client secrets stay in the system credential store. */
export async function getStorageProviderCapabilities(
  query: StorageQuery = DEFAULT_QUERY,
): Promise<StorageProviderCapability[]> {
  let googleOAuthConfigured = false;
  let googleOAuthError = 'Google Drive OAuth system configuration is missing from public."ultrst-credentials" (id="system").';
  try {
    await getSystemGoogleOAuthConfiguration(query);
    googleOAuthConfigured = true;
  } catch (error) {
    googleOAuthError = error instanceof Error ? error.message : googleOAuthError;
  }
  return [
    {
      id: 'backblaze_b2',
      displayName: 'Backblaze B2',
      enabled: true,
      canSelectExistingConnection: true,
      canCreateConnection: true,
      requiredConfigurationFields: ['keyId', 'applicationKey', 'bucketName'],
      authorizationMode: 'application_key',
      discoveryCapabilities: { accounts: true, buckets: true, folders: false },
    },
    {
      id: 'google_drive',
      displayName: 'Google Drive',
      enabled: googleOAuthConfigured,
      ...(!googleOAuthConfigured ? { availabilityReason: googleOAuthError } : {}),
      canSelectExistingConnection: true,
      canCreateConnection: googleOAuthConfigured,
      requiredConfigurationFields: [],
      authorizationMode: 'oauth2',
      discoveryCapabilities: { accounts: true, buckets: false, folders: true },
    },
  ];
}


/** Persist an exchanged or refreshed Google token set against the verified owner. */
export async function persistGoogleDriveTokens(
  userId: string,
  connectionId: string,
  tokens: GoogleDriveWorkspaceTokens,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<PublicStorageConnection> {
  if (!userId || !connectionId || !tokens.accessToken) {
    throw new Error('Google Drive credential persistence inputs are incomplete.');
  }
  const connection = await resolveUserStorageConnectionSecret(userId, connectionId, query, 'google_drive');
  if (!connection) throw new Error('Google Drive connection is not owned by the authenticated user.');

  const updated = {
    ...connection,
    googleAccessToken: tokens.accessToken,
    googleAccessTokenExpiresAt: tokens.expiresAt,
    googleRefreshToken: tokens.refreshToken || connection.googleRefreshToken,
    updatedAt: new Date().toISOString(),
  };
  await persistStorageConnection(userId, updated, query);
  return toPublicStorageConnection(updated)!;
}

/** Construct a server-only Fetch-based Drive client for an owned connection. */
export async function createGoogleDriveWorkspaceClient(
  userId: string,
  connectionId: string,
  query: StorageQuery = DEFAULT_QUERY,
  rootFolderId?: string,
): Promise<GoogleDriveWorkspaceService> {
  const connection = await resolveUserStorageConnectionSecret(userId, connectionId, query, 'google_drive');
  if (!connection) throw new Error('Google Drive connection was not found for this user.');

  const system = await getSystemGoogleOAuthConfiguration(query);
  const tokens: GoogleDriveWorkspaceTokens = {
    accessToken: String(connection.googleAccessToken || ''),
    ...(connection.googleRefreshToken ? { refreshToken: String(connection.googleRefreshToken) } : {}),
    ...(connection.googleAccessTokenExpiresAt
      ? { expiresAt: Number(connection.googleAccessTokenExpiresAt) }
      : {}),
  };
  if (!tokens.accessToken && !tokens.refreshToken) {
    throw new Error('Google Drive connection has no saved authorization tokens. Reconnect the Google account.');
  }

  return new GoogleDriveWorkspaceService({
    clientId: system.clientId,
    clientSecret: system.clientSecret,
    redirectUri: system.redirectUri,
    tokens,
    rootFolderId: rootFolderId || String(connection.googleRootFolderId || 'root'),
    googleAccountId: String(connection.googleAccountId || ''),
    persistTokens: async (nextTokens) => {
      await persistGoogleDriveTokens(userId, connectionId, nextTokens, query);
    },
  });
}

/** Complete the system-configured OAuth exchange and save the resulting user connection. */
export async function completeGoogleDriveAuthorization(
  userId: string,
  code: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<PublicStorageConnection> {
  if (!userId?.trim()) throw new Error('A verified Luth user is required to connect Google Drive.');
  const system = await getSystemGoogleOAuthConfiguration(query);
  const tokens = await GoogleDriveWorkspaceService.exchangeAuthorizationCode(
    {
      clientId: system.clientId,
      clientSecret: system.clientSecret,
      redirectUri: system.redirectUri,
    },
    code,
  );

  const provisional = new GoogleDriveWorkspaceService({
    clientId: system.clientId,
    clientSecret: system.clientSecret,
    redirectUri: system.redirectUri,
    tokens,
  });
  const identity = await provisional.getAccountIdentity();

  const record = await findUserRecord(userId, query);
  if (!record) throw new Error('A canonical user profile was not found for this Google Drive connection.');
  const connections = await mergeLegacySrklConnections(record.id, record.profiles, query);
  const existing = connections.find((item) =>
    item.provider === 'google_drive'
    && (item.googleAccountId === identity.accountId
      || (identity.email && item.googleEmail === identity.email)),
  );
  const now = new Date().toISOString();
  const connection = {
    ...(existing || {}),
    id: existing?.id || `conn_google_drive_${crypto.randomUUID()}`,
    provider: 'google_drive',
    label: `Google Drive — ${identity.email || 'Google account'}`,
    role: existing?.role || (connections.length === 0 ? 'primary' : 'redundant_clone'),
    enabled: true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    testedAt: now,
    testStatus: 'ok',
    googleEmail: identity.email || existing?.googleEmail || '',
    googleAccountId: identity.accountId,
    googleAccessToken: tokens.accessToken,
    googleAccessTokenExpiresAt: tokens.expiresAt,
    googleRefreshToken: tokens.refreshToken || existing?.googleRefreshToken,
    googleRootFolderId: existing?.googleRootFolderId || 'root',
    googleRootFolderName: existing?.googleRootFolderName || 'My Drive',
  };
  await persistStorageConnection(record.id, connection, query);
  return toPublicStorageConnection(connection)!;
}

/** List Drive folders after verifying that the connection belongs to this user. */
export async function listGoogleDriveFoldersForConnection(
  userId: string,
  connectionId: string,
  parentFolderId?: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<GoogleDriveWorkspaceFolder[]> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  await drive.getAccountIdentity();
  return drive.listFolders(parentFolderId || 'root');
}

/** Validate and persist the selected Drive root against the user-owned connection. */
export async function selectGoogleDriveRootFolder(
  userId: string,
  connectionId: string,
  folderId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<GoogleDriveWorkspaceFolder> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  await drive.getAccountIdentity();
  const folder = await drive.selectRootFolder(folderId);
  const connection = await resolveUserStorageConnectionSecret(userId, connectionId, query, 'google_drive');
  if (!connection) throw new Error('Google Drive connection was not found for this user.');
  await persistStorageConnection(userId, {
    ...connection,
    googleRootFolderId: folder.id,
    googleRootFolderName: folder.name,
    updatedAt: new Date().toISOString(),
  }, query);
  return folder;
}


/** Server-only Google Drive file operations; secrets and tokens remain in the user connection. */
export async function testGoogleDriveConnectionForUser(
  userId: string,
  connectionId: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<{ success: boolean; latencyMs: number; error?: string; email?: string }> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  const started = Date.now();
  try {
    const identity = await drive.getAccountIdentity();
    const result = await drive.testConnection();
    return {
      success: Boolean(result.ok),
      latencyMs: Number(result.latencyMs || Date.now() - started),
      ...(identity.email ? { email: identity.email } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Google Drive connection failed.',
    };
  }
}

export async function writeGoogleDriveFileForConnection(
  userId: string,
  connectionId: string,
  path: string,
  data: string | Uint8Array,
  contentType = 'application/octet-stream',
  query: StorageQuery = DEFAULT_QUERY,
): Promise<void> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  await drive.write(path, bytes, contentType);
}

export async function readGoogleDriveFileForConnection(
  userId: string,
  connectionId: string,
  path: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<Uint8Array | null> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  try {
    return await drive.read(path);
  } catch (error) {
    if (error instanceof Error && /not found|HTTP 404/i.test(error.message)) return null;
    throw error;
  }
}

export async function deleteGoogleDriveFileForConnection(
  userId: string,
  connectionId: string,
  path: string,
  query: StorageQuery = DEFAULT_QUERY,
): Promise<void> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  await drive.delete(path);
}

export async function listGoogleDriveFilesForConnection(
  userId: string,
  connectionId: string,
  path = '',
  query: StorageQuery = DEFAULT_QUERY,
): Promise<Array<{ path: string; size: number; modifiedAt: number; isFolder?: boolean }>> {
  const drive = await createGoogleDriveWorkspaceClient(userId, connectionId, query);
  return drive.list(path);
}
