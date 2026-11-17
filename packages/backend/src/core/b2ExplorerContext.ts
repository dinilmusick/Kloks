/**
 * @file b2ExplorerContext.ts
 * @description Owner-bound B2 Explorer connection, bucket scope and safe REST.
 * Credentials remain inside this server-only canonical Kloks layer.
 */
import { authorizeB2, b2ListBuckets, type B2AuthData } from './b2DirectCore.js';
import { resolveUserStorageConnectionSecret } from './storageConnectionCore.js';
import { queryUnifiedDb } from './unifiedDb.js';

export type B2ExplorerAction =
  | 'listBuckets' | 'createBucket' | 'deleteBucket' | 'listFiles'
  | 'createFolder' | 'uploadFile' | 'readFile' | 'deleteFile' | 'deleteFolder';

export interface B2ExplorerInput {
  action: B2ExplorerAction;
  userId: string;
  connectionId: string;
  bucketId?: string;
  bucketName?: string;
  bucketType?: 'allPublic' | 'allPrivate';
  fileName?: string;
  fileId?: string;
  fileBase64?: string;
  folderPath?: string;
  prefix?: string;
  contentType?: string;
  env?: Record<string, unknown>;
}

export type B2ExplorerBucket = {
  bucketId: string;
  bucketName: string;
  bucketType?: string;
  bucketInfo?: Record<string, unknown>;
  revision?: number;
};

export interface B2ExplorerContext {
  auth: B2AuthData;
  keyId: string;
  applicationKey: string;
  buckets: B2ExplorerBucket[];
}

export function safeB2ExplorerPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error('B2 object path must be a safe relative path.');
  }
  if (value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('B2 object path contains an unsafe component.');
  }
  return value;
}

/** Only use an exact saved connection owned by the verified caller. */
export async function resolveB2ExplorerContext(input: B2ExplorerInput): Promise<B2ExplorerContext> {
  const userId = String(input.userId || '').trim();
  const connectionId = String(input.connectionId || '').trim();
  if (!userId || !connectionId) throw new Error('Verified owner and opaque connection ID are required.');
  const connection = await resolveUserStorageConnectionSecret(
    userId, connectionId, (sql, params) => queryUnifiedDb(sql, params, input.env), 'backblaze_b2',
  );
  if (!connection || connection.enabled === false) {
    throw new Error('The selected B2 connection is unavailable to this user.');
  }
  const keyId = String(connection.b2KeyId || connection.keyId || connection.accessKeyId || '').trim();
  const applicationKey = String(connection.b2ApplicationKey || connection.applicationKey || connection.appKey || connection.secretAccessKey || '').trim();
  if (!keyId || !applicationKey) throw new Error('The saved B2 connection has no server-side credential.');
  const [auth, buckets] = await Promise.all([
    authorizeB2(keyId, applicationKey),
    b2ListBuckets(keyId, applicationKey),
  ]);
  return { auth, keyId, applicationKey, buckets };
}

/** Restrict operations to bucket IDs explicitly discovered for this credential. */
export function selectB2ExplorerBucket(
  context: B2ExplorerContext, bucketId?: string, bucketName?: string,
): B2ExplorerBucket {
  const selected = context.buckets.find((b) =>
    (!bucketId || b.bucketId === bucketId) && (!bucketName || b.bucketName === bucketName),
  );
  if (!selected || !selected.bucketId || !selected.bucketName || (!bucketId && !bucketName)) {
    throw new Error('The selected B2 bucket is not available to this connection.');
  }
  return selected;
}

export async function postB2Explorer(
  auth: B2AuthData, endpoint: string, payload: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${auth.apiUrl}/b2api/v2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`B2 ${endpoint} failed with HTTP ${res.status}.`);
  return res.json();
}
