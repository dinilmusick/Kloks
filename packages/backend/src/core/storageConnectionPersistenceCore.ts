/**
 * Canonical user-owned storage connections in the shared ultrst-users profile.
 * Legacy SRKL profile records are imported once and then kept as a safe mirror.
 */

import { encryptSecretToBlob, decryptSecretFromBlob } from './credentialVaultCore.js';
import { getUnifiedDbUrl } from './unifiedDb.js';
import type { StorageConnectionInternal, StorageConnectionPublic, StorageProviderId } from './storageContracts.js';

export type StorageQuery = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;

const SECRET_KEYS = [
  'b2KeyId', 'b2ApplicationKey', 'keyId', 'applicationKey', 'appKey',
  'accessKeyId', 'secretAccessKey', 'r2AccessKeyId', 'r2SecretAccessKey',
  's3AccessKeyId', 's3SecretAccessKey', 'googleAccessToken',
  'googleAccessTokenExpiresAt', 'googleRefreshToken',
] as const;

const PUBLIC_KEYS = [
  'id', 'provider', 'label', 'role', 'enabled', 'createdAt', 'updatedAt',
  'testedAt', 'testStatus', 'latencyMs', 'bucketName', 'b2BucketName',
  'b2Region', 'b2Endpoint', 'bucketNames', 'googleEmail', 'googleAccountId',
  'googleRootFolderId', 'googleRootFolderName', 'authorizationState', 'metadata',
] as const;

function parseObject(value: unknown): Record<string, any> {
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

function normalizeProvider(value: unknown): StorageProviderId {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'backblaze' || provider === 'b2') return 'backblaze_b2';
  if (provider === 'google' || provider === 'gdrive') return 'google_drive';
  if (provider === 'cloudflare' || provider === 'r2') return 'cloudflare_r2';
  if (provider === 'aws' || provider === 's3') return 'aws_s3';
  if (provider === 'local' || provider === 'local') return 'local_fs';
  return provider as StorageProviderId;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function storageVaultKey(userId: string, env?: Record<string, unknown>): string {
  const databaseUrl = getUnifiedDbUrl(env);
  if (!databaseUrl) {
    throw new Error('[STORAGE_CONNECTION_CRYPTO_UNAVAILABLE] System database configuration is required to protect user storage credentials.');
  }
  return `ultrst-user-storage-connections:v1:${databaseUrl}:${userId}`;
}

function readSecrets(raw: Record<string, any>): Record<string, unknown> {
  const secrets: Record<string, unknown> = {};
  const aliases: Record<string, string[]> = {
    b2KeyId: ['b2KeyId', 'keyId'],
    b2ApplicationKey: ['b2ApplicationKey', 'applicationKey', 'appKey'],
    accessKeyId: ['accessKeyId', 's3AccessKeyId', 'r2AccessKeyId'],
    secretAccessKey: ['secretAccessKey', 's3SecretAccessKey', 'r2SecretAccessKey'],
    googleAccessToken: ['googleAccessToken', 'accessToken'],
    googleAccessTokenExpiresAt: ['googleAccessTokenExpiresAt', 'accessTokenExpiresAt'],
    googleRefreshToken: ['googleRefreshToken', 'refreshToken'],
  };
  for (const [target, candidates] of Object.entries(aliases)) {
    const found = candidates.map((key) => raw[key]).find((value) => value !== undefined && value !== null && value !== '');
    if (found !== undefined) secrets[target] = found;
  }
  return secrets;
}

function stripSecrets(raw: Record<string, any>): Record<string, any> {
  const value = { ...raw };
  for (const key of SECRET_KEYS) delete value[key];
  delete value.credentials;
  delete value.secrets;
  return value;
}

async function decodeStoredConnection(
  raw: Record<string, any>,
  userId: string,
  env?: Record<string, unknown>,
): Promise<StorageConnectionInternal> {
  const safe = stripSecrets(raw);
  let secrets: Record<string, unknown> = {};
  if (typeof raw.credentialsEncrypted === 'string' && raw.credentialsEncrypted) {
    try {
      secrets = await decryptSecretFromBlob(fromBase64(raw.credentialsEncrypted), storageVaultKey(userId, env));
    } catch {
      throw new Error('A saved storage connection could not be decrypted. Check the canonical system database configuration before rotating database URLs.');
    }
  } else {
    secrets = readSecrets(raw);
  }
  return {
    ...safe,
    id: String(raw.id || ''),
    provider: normalizeProvider(raw.provider),
    label: String(raw.label || raw.name || raw.id || 'Storage connection'),
    enabled: raw.enabled !== false,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    ...secrets,
  } as StorageConnectionInternal;
}

async function encodeStoredConnection(
  raw: Record<string, any>,
  userId: string,
  env?: Record<string, unknown>,
): Promise<Record<string, any>> {
  const normalized = stripSecrets(raw);
  const provider = normalizeProvider(raw.provider);
  const secrets = raw.credentialsEncrypted
    ? await decryptSecretFromBlob(fromBase64(raw.credentialsEncrypted), storageVaultKey(userId, env))
    : readSecrets(raw);
  if (Object.keys(secrets).length) {
    const blob = await encryptSecretToBlob(secrets, storageVaultKey(userId, env));
    normalized.credentialsEncrypted = toBase64(blob);
  } else if (typeof raw.credentialsEncrypted === 'string') {
    normalized.credentialsEncrypted = raw.credentialsEncrypted;
  }
  normalized.id = String(raw.id || `conn_${provider}_${Date.now()}`);
  normalized.provider = provider;
  normalized.label = String(raw.label || raw.name || normalized.id);
  normalized.enabled = raw.enabled !== false;
  normalized.createdAt = String(raw.createdAt || new Date().toISOString());
  return normalized;
}

function connectionLists(profiles: Record<string, any>): any[][] {
  const lists: any[][] = [];
  if (Array.isArray(profiles.srkl?.storage_connections)) lists.push(profiles.srkl.storage_connections);
  for (const [key, app] of Object.entries(profiles)) {
    if (key !== 'srkl' && app && typeof app === 'object' && Array.isArray((app as any).storage_connections)) {
      lists.push((app as any).storage_connections);
    }
  }
  if (Array.isArray(profiles.storage_connections)) lists.push(profiles.storage_connections);
  return lists;
}

function mergeConnections(...lists: any[][]): any[] {
  const byId = new Map<string, any>();
  for (const list of lists) {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.id || '').trim();
      if (!id) continue;
      const prior = byId.get(id);
      byId.set(id, prior ? { ...prior, ...raw } : raw);
    }
  }
  return [...byId.values()];
}

async function tryReadLegacySrklProfile(
  userId: string,
  email: string | undefined,
  queryDb: StorageQuery,
): Promise<Record<string, any> | null> {
  try {
    const result = await queryDb(
      'SELECT id, app_profiles FROM "srkl_application_profiles" WHERE id = $1 OR email = $2 LIMIT 1',
      [userId, email || userId],
    );
    return result.rows[0] ? parseObject(result.rows[0].app_profiles) : null;
  } catch (error: any) {
    if (error?.code === '42P01' || /does not exist|undefined table/i.test(String(error?.message || ''))) return null;
    throw error;
  }
}

function ensureSrklProfile(profiles: Record<string, any>): Record<string, any> {
  if (!profiles.srkl || typeof profiles.srkl !== 'object') profiles.srkl = {};
  return profiles.srkl;
}

function publicProjection(connection: StorageConnectionInternal | Record<string, any>): StorageConnectionPublic {
  const result: Record<string, any> = {};
  for (const key of PUBLIC_KEYS) {
    const value = (connection as Record<string, any>)[key];
    if (value !== undefined) result[key] = value;
  }
  return result as StorageConnectionPublic;
}

async function persistCanonicalProfiles(
  userId: string,
  userRow: Record<string, any>,
  profiles: Record<string, any>,
  queryDb: StorageQuery,
): Promise<void> {
  await queryDb(
    'UPDATE "ultrst-users" SET app_profiles = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(profiles), userRow.id || userId],
  );

  // SRKL's profile table remains a compatibility mirror for its workspace/vault
  // records. The mirror contains encrypted connection payloads, never plaintext.
  try {
    const legacyResult = await queryDb(
      'SELECT id, app_profiles FROM "srkl_application_profiles" WHERE id = $1 LIMIT 1',
      [userRow.id || userId],
    );
    if (legacyResult.rows[0]) {
      const legacyProfiles = parseObject(legacyResult.rows[0].app_profiles);
      const legacySrkl = ensureSrklProfile(legacyProfiles);
      legacySrkl.storage_connections = ensureSrklProfile(profiles).storage_connections || [];
      await queryDb(
        'UPDATE "srkl_application_profiles" SET app_profiles = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(legacyProfiles), legacyResult.rows[0].id],
      );
    }
  } catch (error: any) {
    if (!(error?.code === '42P01' || /does not exist|undefined table/i.test(String(error?.message || '')))) throw error;
  }
}

/** Load server-only connections and transparently encrypt old plaintext profile records. */
export async function getUserStorageConnections(
  userId: string,
  queryDb: StorageQuery,
  env?: Record<string, unknown>,
): Promise<StorageConnectionInternal[]> {
  if (!userId) return [];
  const userResult = await queryDb(
    'SELECT id, email, app_profiles FROM "ultrst-users" WHERE id = $1 OR email = $1 LIMIT 1',
    [userId, userId],
  );
  const userRow = userResult.rows[0];
  if (!userRow) throw new Error('Storage connection owner was not found in the canonical user directory.');

  const profiles = parseObject(userRow.app_profiles);
  const srkl = ensureSrklProfile(profiles);
  const canonical = connectionLists(profiles);
  const legacyProfiles = await tryReadLegacySrklProfile(String(userRow.id), userRow.email, queryDb);
  const legacyConnections = legacyProfiles
    ? (connectionLists(legacyProfiles).flat())
    : [];
  const rawConnections = mergeConnections(...canonical, legacyConnections);

  const persisted: Record<string, any>[] = [];
  const internal: StorageConnectionInternal[] = [];
  let changed = canonical.length === 0 && legacyConnections.length > 0;
  for (const raw of rawConnections) {
    const encoded = await encodeStoredConnection(raw, String(userRow.id), env);
    const decoded = await decodeStoredConnection(encoded, String(userRow.id), env);
    persisted.push(encoded);
    internal.push(decoded);
    if (!raw.credentialsEncrypted || Object.keys(readSecrets(raw)).length) changed = true;
  }

  if (changed || JSON.stringify(srkl.storage_connections || []) !== JSON.stringify(persisted)) {
    srkl.storage_connections = persisted;
    await persistCanonicalProfiles(String(userRow.id), userRow, profiles, queryDb);
  }
  return internal;
}

/** Browser-safe account metadata. No encrypted blobs or provider tokens are returned. */
export async function listUserStorageConnections(
  userId: string,
  queryDb: StorageQuery,
  env?: Record<string, unknown>,
): Promise<StorageConnectionPublic[]> {
  const items = await getUserStorageConnections(userId, queryDb, env);
  return items.map(publicProjection);
}

export async function resolveUserStorageConnection(
  userId: string,
  connectionId: string,
  queryDb: StorageQuery,
  env?: Record<string, unknown>,
): Promise<StorageConnectionInternal> {
  const connection = (await getUserStorageConnections(userId, queryDb, env))
    .find((item) => item.id === connectionId && item.enabled !== false);
  if (!connection) throw new Error('Storage connection was not found or is disabled for this user.');
  return connection;
}

export async function saveUserStorageConnection(
  userId: string,
  connection: StorageConnectionInternal,
  queryDb: StorageQuery,
  env?: Record<string, unknown>,
): Promise<StorageConnectionPublic> {
  if (!userId) throw new Error('A verified storage connection owner is required.');
  if (!connection?.id || !connection.provider) throw new Error('Storage connection ID and provider are required.');
  const userResult = await queryDb(
    'SELECT id, email, app_profiles FROM "ultrst-users" WHERE id = $1 OR email = $1 LIMIT 1',
    [userId, userId],
  );
  const userRow = userResult.rows[0];
  if (!userRow) throw new Error('Storage connection owner was not found in the canonical user directory.');

  const profiles = parseObject(userRow.app_profiles);
  const srkl = ensureSrklProfile(profiles);
  const current = await getUserStorageConnections(userId, queryDb, env);
  const now = new Date().toISOString();
  const candidate = {
    ...connection,
    createdAt: connection.createdAt || now,
    updatedAt: now,
    enabled: connection.enabled !== false,
  };
  const index = current.findIndex((item) => item.id === candidate.id);
  if (!candidate.role) candidate.role = current.length === 0 ? 'primary' : 'redundant_clone';
  const next = [...current];
  if (index >= 0) next[index] = candidate;
  else next.push(candidate);
  if (!next.some((item) => item.role === 'primary')) next[0].role = 'primary';

  srkl.storage_connections = [];
  for (const item of next) srkl.storage_connections.push(await encodeStoredConnection(item, String(userRow.id), env));
  await persistCanonicalProfiles(String(userRow.id), userRow, profiles, queryDb);
  return publicProjection(candidate);
}

export async function deleteUserStorageConnection(
  userId: string,
  connectionId: string,
  queryDb: StorageQuery,
  env?: Record<string, unknown>,
): Promise<StorageConnectionPublic[]> {
  const userResult = await queryDb(
    'SELECT id, email, app_profiles FROM "ultrst-users" WHERE id = $1 OR email = $1 LIMIT 1',
    [userId, userId],
  );
  const userRow = userResult.rows[0];
  if (!userRow) throw new Error('Storage connection owner was not found in the canonical user directory.');
  const profiles = parseObject(userRow.app_profiles);
  const srkl = ensureSrklProfile(profiles);
  const connections = await getUserStorageConnections(userId, queryDb, env);
  const remaining = connections.filter((item) => item.id !== connectionId);
  if (remaining.length === connections.length) throw new Error('Storage connection was not found.');
  if (remaining.length && !remaining.some((item) => item.role === 'primary')) remaining[0].role = 'primary';
  srkl.storage_connections = [];
  for (const item of remaining) srkl.storage_connections.push(await encodeStoredConnection(item, String(userRow.id), env));
  await persistCanonicalProfiles(String(userRow.id), userRow, profiles, queryDb);
  return remaining.map(publicProjection);
}

export async function updateUserStorageConnectionSecrets(
  userId: string,
  connectionId: string,
  secrets: Record<string, unknown>,
  queryDb: StorageQuery,
  env?: Record<string, unknown>,
): Promise<StorageConnectionInternal> {
  const connections = await getUserStorageConnections(userId, queryDb, env);
  const item = connections.find((connection) => connection.id === connectionId);
  if (!item) throw new Error('Storage connection was not found.');
  const updated = { ...item, ...secrets, updatedAt: new Date().toISOString() };
  await saveUserStorageConnection(userId, updated, queryDb, env);
  return updated;
}
