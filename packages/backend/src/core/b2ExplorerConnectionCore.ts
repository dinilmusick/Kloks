/**
 * @file b2ExplorerConnectionCore.ts
 * @description Owner-bound Backblaze Explorer facade. Never accepts raw B2
 * credentials from an application operation or returns provider tokens.
 */
import {
  listUserStorageConnectionsWithSecrets,
  resolveUserStorageConnectionSecret,
} from './storageConnectionCore.js';
import {
  authorizeB2, listB2ExplorerBuckets, listB2ExplorerObjects,
  createB2ExplorerBucket, deleteB2ExplorerBucket, uploadB2ExplorerObject,
  downloadB2ExplorerObject, deleteB2ExplorerVersions, safeB2Path,
  type B2ExplorerBucket, type B2ExplorerCredentials,
} from './b2ExplorerProviderCore.js';

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }>;
export type B2ExplorerAction =
  | 'listBuckets' | 'createBucket' | 'deleteBucket' | 'listFiles'
  | 'uploadFile' | 'createFolder' | 'downloadFile' | 'deleteFile' | 'deleteFolder';
export interface B2ExplorerInput {
  userId: string;
  connectionId: string;
  action: B2ExplorerAction;
  bucketId?: string;
  bucketName?: string;
  bucketType?: 'allPrivate' | 'allPublic';
  prefix?: string;
  fileName?: string;
  fileId?: string;
  folderPath?: string;
  content?: Uint8Array;
  contentType?: string;
}
interface ResolvedB2Connection {
  credentials: B2ExplorerCredentials;
  savedBucketName: string;
}

async function resolveOwner(
  input: B2ExplorerInput, query: Query,
): Promise<ResolvedB2Connection> {
  if (!input.userId?.trim() || !input.connectionId?.trim()) {
    throw new Error('A verified user and opaque Backblaze connection ID are required.');
  }
  const connection = await resolveUserStorageConnectionSecret(
    input.userId, input.connectionId, query, 'backblaze_b2',
  );
  if (!connection || connection.enabled === false) {
    throw new Error('Backblaze storage connection is not available for this verified user.');
  }
  const keyId = String(connection.b2KeyId || connection.keyId || connection.accessKeyId || '').trim();
  const applicationKey = String(connection.b2ApplicationKey || connection.applicationKey
    || connection.appKey || connection.secretAccessKey || '').trim();
  if (!keyId || !applicationKey) throw new Error('Saved Backblaze connection is missing server-owned credentials.');
  return {
    credentials: { keyId, applicationKey },
    savedBucketName: String(connection.b2BucketName || connection.bucketName || '').trim(),
  };
}
function authorizedBucket(
  input: B2ExplorerInput, buckets: B2ExplorerBucket[],
): B2ExplorerBucket {
  if (!input.bucketId?.trim() && !input.bucketName?.trim()) {
    throw new Error('A Backblaze bucket ID or name is required.');
  }
  const matching = buckets.filter(bucket =>
    (!input.bucketId || input.bucketId === bucket.id)
    && (!input.bucketName || input.bucketName === bucket.name),
  );
  if (matching.length !== 1) throw new Error('The requested bucket is not authorized for this connection.');
  return matching[0];
}
export async function executeBackblazeExplorer(
  input: B2ExplorerInput, query: Query,
): Promise<Record<string, unknown>> {
  if (!input.action || ![
    'listBuckets', 'createBucket', 'deleteBucket', 'listFiles', 'uploadFile',
    'createFolder', 'downloadFile', 'deleteFile', 'deleteFolder',
  ].includes(input.action)) throw new Error('Unsupported Backblaze Explorer operation.');

  const owner = await resolveOwner(input, query);
  const { credentials } = owner;
  if (input.action === 'listBuckets') {
    return { buckets: await listB2ExplorerBuckets(credentials) };
  }
  const auth = await authorizeB2(credentials.keyId, credentials.applicationKey);

  if (input.action === 'createBucket') {
    if (auth.allowed?.bucketId || auth.allowed?.bucketName || auth.allowed?.buckets?.length) {
      throw new Error('Bucket creation requires an account-wide Backblaze connection.');
    }
    const name = String(input.bucketName || '').trim();
    const bucket = await createB2ExplorerBucket(auth, name, input.bucketType || 'allPrivate');
    return { bucket };
  }
  const buckets = await listB2ExplorerBuckets(credentials);
  const bucket = authorizedBucket(input, buckets);

  if (input.action === 'deleteBucket') {
    const allConnections = await listUserStorageConnectionsWithSecrets(input.userId, query);
    if (allConnections.some(connection => connection.provider === 'backblaze_b2'
      && String(connection.b2BucketName || connection.bucketName || '') === bucket.name)) {
      throw new Error('A bucket referenced by a saved storage connection cannot be deleted.');
    }
    await deleteB2ExplorerBucket(auth, bucket.id);
    return { success: true };
  }
  if (input.action === 'listFiles') {
    const files = await listB2ExplorerObjects(auth, bucket.id, input.prefix || '');
    return { files };
  }
  if (input.action === 'uploadFile') {
    const content = input.content;
    if (!(content instanceof Uint8Array) || content.byteLength > 16 * 1024 * 1024) {
      throw new Error('Backblaze upload requires bytes of at most 16 MiB.');
    }
    const file = await uploadB2ExplorerObject(
      credentials, bucket.name, String(input.fileName || ''),
      content, input.contentType,
    );
    return { file };
  }
  if (input.action === 'createFolder') {
    const folder = safeB2Path(String(input.folderPath || '').replace(/\/$/, ''));
    const file = await uploadB2ExplorerObject(
      credentials, bucket.name, `${folder}/.bzEmpty`,
      new Uint8Array(0), 'application/x-empty',
    );
    return { folderPath: folder, file };
  }
  if (input.action === 'downloadFile') {
    const file = await downloadB2ExplorerObject(auth, bucket.name, String(input.fileName || ''));
    return file
      ? { found: true, content: file.content, contentType: file.contentType }
      : { found: false };
  }
  if (input.action === 'deleteFile') {
    const count = await deleteB2ExplorerVersions(
      credentials, auth, bucket.id, String(input.fileName || ''), false, input.fileId,
    );
    return { success: true, deletedCount: count };
  }
  const count = await deleteB2ExplorerVersions(
    credentials, auth, bucket.id, String(input.folderPath || ''), true,
  );
  return { success: true, deletedCount: count };
}
