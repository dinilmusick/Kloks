/**
 * @file b2DirectCore.ts
 * @description Direct REST API Client for Backblaze B2 Object Storage in Qwnsr.
 * Zero-dependency, pure web-standard fetch. Runs on Node, Vercel, and Cloudflare Workers.
 */

export interface B2AuthData {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  s3ApiUrl?: string;
  allowed?: {
    bucketId?: string | null;
    bucketName?: string | null;
    buckets?: Array<{ bucketId: string; bucketName: string }>;
    capabilities?: string[];
  };
}

const authCache = new Map<string, { auth: B2AuthData; expiresAt: number }>();
const bucketIdCache = new Map<string, string>();

export async function authorizeB2(keyId: string, applicationKey: string): Promise<B2AuthData> {
  const cacheKey = `${keyId.trim()}:${applicationKey.trim()}`;
  const cached = authCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.auth;

  const authHeader = typeof Buffer !== 'undefined'
    ? Buffer.from(`${keyId.trim()}:${applicationKey.trim()}`).toString('base64')
    : btoa(`${keyId.trim()}:${applicationKey.trim()}`);
  let res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${authHeader}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    res = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
      headers: { Authorization: `Basic ${authHeader}` },
      signal: AbortSignal.timeout(10000),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Backblaze B2 authorization failed (${res.status}): ${errText}`);
  }

  const data: any = await res.json();
  const auth: B2AuthData = {
    accountId: data.accountId,
    authorizationToken: data.authorizationToken,
    apiUrl: (data.apiInfo?.storageApi?.apiUrl || data.apiUrl || 'https://api.backblazeb2.com').replace(/\/+$/, ''),
    downloadUrl: (data.apiInfo?.storageApi?.downloadUrl || data.downloadUrl || data.apiUrl || 'https://f003.backblazeb2.com').replace(/\/+$/, ''),
    s3ApiUrl: data.apiInfo?.storageApi?.s3ApiUrl || data.s3ApiUrl,
    allowed: data.apiInfo?.storageApi?.allowed || data.allowed,
  };

  authCache.set(cacheKey, { auth, expiresAt: Date.now() + 20 * 60 * 1000 });
  return auth;
}

export async function b2ListBuckets(keyId: string, applicationKey: string, bucketId?: string, bucketName?: string) {
  const auth = await authorizeB2(keyId, applicationKey);
  const rBucketId = bucketId || auth.allowed?.bucketId || auth.allowed?.buckets?.[0]?.bucketId;
  const rBucketName = bucketName || auth.allowed?.bucketName || auth.allowed?.buckets?.[0]?.bucketName;

  // 1. If key is unrestricted, query all buckets in the account
  if (!auth.allowed?.bucketId && !auth.allowed?.bucketName) {
    try {
      const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
        method: 'POST',
        headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: auth.accountId }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.buckets) && data.buckets.length > 0) return data.buckets;
      }
    } catch (err: any) {
      console.warn('[B2DirectCore] list_buckets query failed:', err.message);
    }
  }

  // 2. Restricted key or fallback with specific bucketId/bucketName
  if (rBucketId || rBucketName) {
    const body: Record<string, unknown> = { accountId: auth.accountId };
    if (rBucketId) body.bucketId = rBucketId;
    else if (rBucketName) body.bucketName = rBucketName;
    try {
      const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
        method: 'POST',
        headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.buckets) && data.buckets.length > 0) return data.buckets;
      }
    } catch {}

    return [{
      accountId: auth.accountId,
      bucketId: rBucketId || 'restricted',
      bucketName: rBucketName || (bucketName || 'default-bucket'),
      bucketType: 'allPrivate',
    }];
  }
  return [];
}

export async function getB2BucketId(keyId: string, applicationKey: string, bucketName: string): Promise<string> {
  const cacheKey = `${keyId.trim()}:${bucketName.trim()}`;
  if (bucketIdCache.has(cacheKey)) return bucketIdCache.get(cacheKey)!;

  const buckets = await b2ListBuckets(keyId, applicationKey, undefined, bucketName);
  const match = buckets.find((b: any) => b.bucketName === bucketName);
  if (!match) throw new Error(`B2 bucket "${bucketName}" not found in account`);

  bucketIdCache.set(cacheKey, match.bucketId);
  return match.bucketId;
}

export async function b2UploadFile(keyId: string, applicationKey: string, bucketName: string, fileName: string, buffer: Uint8Array, contentType = 'b2/x-auto') {
  const auth = await authorizeB2(keyId, applicationKey);
  const bucketId = await getB2BucketId(keyId, applicationKey, bucketName);
  const urlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId }),
  });
  if (!urlRes.ok) throw new Error(`B2 get upload url failed (${urlRes.status})`);
  const { uploadUrl, authorizationToken } = (await urlRes.json()) as any;
  const encodedFileName = encodeURIComponent(fileName).replace(/%2F/g, '/');
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authorizationToken,
      'X-Bz-File-Name': encodedFileName,
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: buffer as any,
  });
  if (!uploadRes.ok) throw new Error(`B2 upload failed for ${fileName} (${uploadRes.status}): ${await uploadRes.text()}`);
  return uploadRes.json();
}

export async function b2DownloadFile(keyId: string, applicationKey: string, bucketName: string, fileName: string): Promise<Uint8Array | null> {
  const auth = await authorizeB2(keyId, applicationKey);
  const encodedName = encodeURIComponent(fileName).replace(/%2F/g, '/');
  const res = await fetch(`${auth.downloadUrl}/file/${bucketName}/${encodedName}`, { headers: { Authorization: auth.authorizationToken } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 download failed for ${fileName} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function b2ListFileNames(keyId: string, applicationKey: string, bucketName: string, prefix = '') {
  const auth = await authorizeB2(keyId, applicationKey);
  const bucketId = await getB2BucketId(keyId, applicationKey, bucketName);
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId, prefix, maxFileCount: 1000 }),
  });
  if (!res.ok) throw new Error(`B2 list files failed (${res.status})`);
  const data: any = await res.json();
  return (data.files || []) as Array<{ fileName: string; fileId: string; contentLength: number; uploadTimestamp: number }>;
}

export async function b2DeleteFileVersion(keyId: string, applicationKey: string, fileName: string, fileId: string) {
  const auth = await authorizeB2(keyId, applicationKey);
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileId }),
  });
  if (!res.ok) throw new Error(`B2 delete file version failed (${res.status})`);
  return res.json();
}

export async function b2DeleteFolder(keyId: string, applicationKey: string, bucketName: string, folderPrefix: string) {
  const cleanPrefix = folderPrefix.replace(/\/+$/, '') + '/';
  const files = await b2ListFileNames(keyId, applicationKey, bucketName, cleanPrefix);
  let deletedCount = 0;
  for (const file of files) {
    await b2DeleteFileVersion(keyId, applicationKey, file.fileName, file.fileId);
    deletedCount++;
  }
  return { success: true, deletedCount };
}
