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

async function getSystemGoogleOAuthConfig(query: StorageQuery): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  stateSecret?: string;
} | null> {
  try {
    const result = await query(
      'SELECT credentials FROM public."ultrst-credentials" WHERE id = $1 LIMIT 1',
      ['system'],
    );
    const raw = result.rows[0]?.credentials;
    const credentials = parseProfiles(raw);
    const oauth = credentials.googleDriveOAuth || credentials.googleOAuth || {};
    const clientId = String(oauth.clientId || '').trim();
    const clientSecret = String(oauth.clientSecret || '').trim();
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      redirectUri: String(oauth.redirectUri || '').trim() || undefined,
      stateSecret: String(oauth.stateSecret || '').trim() || undefined,
    };
  } catch {
    return null;
  }
}

/** Only capability metadata is exposed; client secrets stay in the system credential store. */
export async function getStorageProviderCapabilities(
  query: StorageQuery = DEFAULT_QUERY,
): Promise<StorageProviderCapability[]> {
  const googleOAuth = await getSystemGoogleOAuthConfig(query);
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
      enabled: Boolean(googleOAuth),
      ...(googleOAuth ? {} : { availabilityReason: 'Google Drive OAuth client configuration is missing from system credentials.' }),
      canSelectExistingConnection: true,
      canCreateConnection: Boolean(googleOAuth),
      requiredConfigurationFields: [],
      authorizationMode: 'oauth2',
      discoveryCapabilities: { accounts: true, buckets: false, folders: true },
    },
  ];
}
