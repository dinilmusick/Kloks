/**
 * @file b2ExplorerProviderCore.ts
 * @description Fetch-native Backblaze Explorer operations. Server-only usage.
 * Never return B2 authorization tokens, raw credentials, or signed URLs.
 */
import {
  authorizeB2, b2ListBuckets, b2UploadFile, b2DeleteFileVersion,
  type B2AuthData,
} from './b2DirectCore.js';

export interface B2ExplorerCredentials { keyId: string; applicationKey: string }
export interface B2ExplorerBucket { id: string; name: string; type: string }
export interface B2ExplorerFile {
  fileName: string; fileId?: string; action?: string; contentLength?: number;
  contentType?: string; contentSha1?: string; uploadTimestamp?: number;
}
const MAX_PAGES = 20;

export function safeB2Path(value: string, allowEmpty = false): string {
  const raw = String(value || '').replaceAll('\\', '/');
  if (allowEmpty && !raw) return '';
  if (!raw || raw.startsWith('/') || /[\u0000-\u001f\u007f]/.test(raw)
      || raw.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Backblaze object path must be a safe relative path.');
  }
  return raw;
}
async function requestB2<T extends Record<string, any>>(
  auth: B2AuthData, operation: string, body: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${auth.apiUrl}/b2api/v2/${operation}`, {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(`Backblaze ${operation} request failed before receiving a response.`);
  }
  if (!response.ok) throw new Error(`Backblaze ${operation} failed with HTTP ${response.status}.`);
  const data = await response.json() as T;
  if (!data || typeof data !== 'object') throw new Error(`Backblaze ${operation} returned invalid JSON.`);
  return data;
}
export async function listB2ExplorerBuckets(credentials: B2ExplorerCredentials): Promise<B2ExplorerBucket[]> {
  const buckets = await b2ListBuckets(credentials.keyId, credentials.applicationKey);
  return buckets.map((bucket: any) => ({
    id: String(bucket.bucketId || ''),
    name: String(bucket.bucketName || ''),
    type: String(bucket.bucketType || 'allPrivate'),
  })).filter(bucket => bucket.id && bucket.name);
}
export async function listB2ExplorerObjects(
  auth: B2AuthData, bucketId: string, prefix = '', versions = false,
): Promise<B2ExplorerFile[]> {
  const safePrefix = prefix ? safeB2Path(prefix.replace(/\/$/, '')) + (prefix.endsWith('/') ? '/' : '') : '';
  const operation = versions ? 'b2_list_file_versions' : 'b2_list_file_names';
  let cursorName: string | undefined;
  let cursorId: string | undefined;
  const collected: B2ExplorerFile[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await requestB2<{
      files?: B2ExplorerFile[];
      nextFileName?: string | null;
      nextFileId?: string | null;
    }>(auth, operation, {
      bucketId, prefix: safePrefix, maxFileCount: 1000,
      ...(cursorName ? { startFileName: cursorName } : {}),
      ...(versions && cursorId ? { startFileId: cursorId } : {}),
    });
    if (!Array.isArray(response.files)) throw new Error(`Backblaze ${operation} returned no files array.`);
    collected.push(...response.files);
    if (!response.nextFileName) return collected;
    const marker = `${response.nextFileName}:${response.nextFileId || ''}`;
    if (seen.has(marker)) throw new Error('Backblaze returned a repeated file page cursor.');
    seen.add(marker);
    cursorName = response.nextFileName;
    cursorId = response.nextFileId || undefined;
    if (versions && !cursorId) throw new Error('Backblaze file-version cursor omitted its file ID.');
  }
  throw new Error('Backblaze listing exceeded the bounded page limit; listing is incomplete.');
}
export async function createB2ExplorerBucket(
  auth: B2AuthData, bucketName: string, bucketType: 'allPrivate' | 'allPublic',
): Promise<B2ExplorerBucket> {
  if (!/^[A-Za-z0-9-]{6,50}$/.test(bucketName)) throw new Error('Invalid Backblaze bucket name.');
  if (bucketType !== 'allPrivate' && bucketType !== 'allPublic') throw new Error('Invalid Backblaze bucket type.');
  const response = await requestB2<{ bucketId: string; bucketName: string; bucketType: string }>(
    auth, 'b2_create_bucket', { accountId: auth.accountId, bucketName, bucketType },
  );
  if (!response.bucketId || response.bucketName !== bucketName) throw new Error('B2 bucket creation returned an invalid response.');
  return { id: response.bucketId, name: response.bucketName, type: response.bucketType };
}
export async function deleteB2ExplorerBucket(auth: B2AuthData, bucketId: string): Promise<void> {
  await requestB2(auth, 'b2_delete_bucket', { accountId: auth.accountId, bucketId });
}
export async function uploadB2ExplorerObject(
  credentials: B2ExplorerCredentials, bucketName: string,
  fileName: string, content: Uint8Array, contentType = 'application/octet-stream',
): Promise<B2ExplorerFile> {
  const result = await b2UploadFile(
    credentials.keyId, credentials.applicationKey, bucketName,
    safeB2Path(fileName), content, contentType,
  ) as B2ExplorerFile;
  if (!result.fileId) throw new Error('Backblaze upload returned no file ID.');
  return result;
}
export async function downloadB2ExplorerObject(
  auth: B2AuthData, bucketName: string, fileName: string,
): Promise<{ content: Uint8Array; contentType: string } | null> {
  const path = safeB2Path(fileName);
  const encoded = encodeURIComponent(path).replace(/%2F/gi, '/');
  const res = await fetch(`${auth.downloadUrl}/file/${encodeURIComponent(bucketName)}/${encoded}`, {
    headers: { Authorization: auth.authorizationToken }, signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backblaze download failed with HTTP ${res.status}.`);
  return {
    content: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}
export async function deleteB2ExplorerVersions(
  credentials: B2ExplorerCredentials, auth: B2AuthData,
  bucketId: string, path: string, folder: boolean, exactFileId?: string,
): Promise<number> {
  const clean = safeB2Path(path.replace(/\/$/, ''));
  const prefix = folder ? `${clean}/` : clean;
  const versions = await listB2ExplorerObjects(auth, bucketId, prefix, true);
  const matches = versions.filter(item =>
    typeof item.fileId === 'string' && Boolean(item.fileId)
    && (folder ? item.fileName.startsWith(prefix) : item.fileName === prefix)
    && (!exactFileId || item.fileId === exactFileId),
  );
  if (exactFileId && matches.length !== 1) throw new Error('Requested Backblaze file revision does not exist in the selected bucket.');
  for (const file of matches) {
    await b2DeleteFileVersion(credentials.keyId, credentials.applicationKey, file.fileName, file.fileId!);
  }
  return matches.length;
}
export { authorizeB2 };
