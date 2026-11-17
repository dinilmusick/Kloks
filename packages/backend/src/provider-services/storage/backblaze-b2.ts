import { b2ListBuckets, b2ListFileNames, b2DownloadFile, b2UploadFile }
  from '../../storage/B2DirectClient.js';
import { normalizeStoragePath, UnsupportedStorageOperation } from './contract.js';
import type { StorageService, StoragePage } from './contract.js';

export interface B2StorageCredentials {
  readonly keyId: string;
  readonly applicationKey: string;
}
/** Reuses existing B2 APIs and preserves the provider's bucket/file boundary. */
export function createBackblazeB2StorageService(creds: B2StorageCredentials): StorageService {
  if (!creds.keyId?.trim() || !creds.applicationKey?.trim())
    throw new Error('Backblaze application key and key ID required');
  const splitPath = (path: string): { bucket: string; file: string } => {
    const [bucket, ...rest] = normalizeStoragePath(path).split('/');
    if (!bucket) throw new Error('Backblaze bucket is required');
    return { bucket, file: rest.join('/') };
  };
  return {
    providerId: 'backblaze-b2',
    capabilities: Object.freeze({ list: true, read: true, write: true, delete: false }),
    async list(path = '', cursor?: string): Promise<StoragePage> {
      if (cursor) throw new Error('B2 native adapter does not provide continuation tokens');
      if (!normalizeStoragePath(path)) {
        const buckets = await b2ListBuckets(creds.keyId, creds.applicationKey);
        return { entries: buckets.map((b: { bucketId: string; bucketName: string }) => ({
          id: b.bucketId, name: b.bucketName, path: '/' + b.bucketName, kind: 'bucket' as const,
        })), nextCursor: null, complete: true };
      }
      const { bucket, file } = splitPath(path);
      const items = await b2ListFileNames(creds.keyId, creds.applicationKey, bucket, file);
      if (items.length >= 1000)
        throw new Error('B2 listing might be truncated; refusing to report an incomplete list');
      return { entries: items.map(item => ({
        id: item.fileId, name: item.fileName.split('/').pop() || item.fileName,
        path: '/' + bucket + '/' + item.fileName, kind: 'file' as const,
        size: item.contentLength,
      })), nextCursor: null, complete: true };
    },
    async read(path: string): Promise<Uint8Array> {
      const { bucket, file } = splitPath(path);
      if (!file) throw new Error('Backblaze file path is required');
      const data = await b2DownloadFile(creds.keyId, creds.applicationKey, bucket, file);
      if (!data) throw new Error('Backblaze file not found');
      return data;
    },
    async write(path: string, data: Uint8Array | string, contentType?: string): Promise<void> {
      const { bucket, file } = splitPath(path);
      if (!file) throw new Error('Backblaze file path is required');
      await b2UploadFile(creds.keyId, creds.applicationKey, bucket, file, data,
        contentType || 'application/octet-stream');
    },
    async delete(): Promise<void> {
      throw new UnsupportedStorageOperation('backblaze-b2', 'delete');
    },
  };
}
