/**
 * @file B2DirectClient.ts
 * @description Zero-dependency Web Standard Fetch client for Backblaze B2 Direct REST API.
 * Identical across Node.js, Vercel Serverless, and Cloudflare Workers (< 200 lines).
 */

export interface B2AuthToken {
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  accountId: string;
}

const authCache = new Map<string, { token: B2AuthToken; expiresAt: number }>();

export async function authorizeB2(keyId: string, applicationKey: string): Promise<B2AuthToken> {
  const normalizedKeyId = keyId.trim();
  const normalizedApplicationKey = applicationKey.trim();
  if (!normalizedKeyId || !normalizedApplicationKey) {
    throw new Error('B2 credentials are required.');
  }
  const cacheKey = `${normalizedKeyId}:${normalizedApplicationKey}`;
  const cached = authCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const basic = btoa(`${normalizedKeyId}:${normalizedApplicationKey}`);
  let res: Response;
  try {
    res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: { Authorization: `Basic ${basic}` },
    });
  } catch {
    throw new Error('B2 authorization request failed before receiving a response.');
  }
  if (!res.ok) throw new Error(`B2 authorization failed with HTTP ${res.status}.`);

  const data: any = await res.json();
  if (
    typeof data.authorizationToken !== 'string'
    || !data.authorizationToken
    || typeof data.apiUrl !== 'string'
    || typeof data.downloadUrl !== 'string'
    || typeof data.accountId !== 'string'
    || !data.accountId
  ) {
    throw new Error('B2 authorization returned an invalid response.');
  }
  const token: B2AuthToken = {
    authorizationToken: data.authorizationToken,
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    accountId: data.accountId,
  };
  authCache.set(cacheKey, { token, expiresAt: Date.now() + 20 * 60 * 1000 });
  return token;
}

export async function b2ListBuckets(keyId: string, applicationKey: string): Promise<any[]> {
  const auth = await authorizeB2(keyId, applicationKey);
  let res: Response;
  try {
    res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: auth.accountId }),
    });
  } catch {
    throw new Error('B2 bucket discovery failed before receiving a response.');
  }
  if (!res.ok) throw new Error(`B2 bucket discovery failed with HTTP ${res.status}.`);
  const data: any = await res.json();
  if (!Array.isArray(data.buckets)) {
    throw new Error('B2 bucket discovery returned an invalid response.');
  }
  return data.buckets;
}

export async function b2ListFileNames(keyId: string, applicationKey: string, bucketName: string, prefix = ''): Promise<any[]> {
  const auth = await authorizeB2(keyId, applicationKey);
  const buckets = await b2ListBuckets(keyId, applicationKey);
  const bucket = buckets.find((b: any) => b.bucketName === bucketName);
  if (!bucket) return [];

  let res: Response;
  try {
    res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: bucket.bucketId, prefix, maxFileCount: 1000 }),
    });
  } catch {
    throw new Error('B2 file listing failed before receiving a response.');
  }
  if (!res.ok) throw new Error(`B2 file listing failed with HTTP ${res.status}.`);
  const data: any = await res.json();
  if (!Array.isArray(data.files)) throw new Error('B2 file listing returned an invalid response.');
  return data.files;
}

export async function b2UploadFile(
  keyId: string,
  applicationKey: string,
  bucketName: string,
  fileName: string,
  content: Uint8Array | string,
  contentType = 'application/json'
): Promise<any> {
  const auth = await authorizeB2(keyId, applicationKey);
  const buckets = await b2ListBuckets(keyId, applicationKey);
  const bucket = buckets.find((b: any) => b.bucketName === bucketName);
  if (!bucket) throw new Error('The selected B2 bucket is not available to this connection.');

  const urlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: bucket.bucketId }),
  });
  if (!urlRes.ok) throw new Error(`B2 upload URL request failed with HTTP ${urlRes.status}.`);
  const { uploadUrl, authorizationToken } = await urlRes.json() as any;

  const raw = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const hashBuffer = await crypto.subtle.digest('SHA-1', raw as unknown as BufferSource);
  const sha1 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(fileName).replace(/%2F/g, '/'),
      'Content-Type': contentType,
      'X-Bz-Content-Sha1': sha1,
    },
    body: raw as any,
  });
  if (!upRes.ok) throw new Error(`B2 file upload failed with HTTP ${upRes.status}.`);
  return await upRes.json();
}

export async function b2DownloadFile(keyId: string, applicationKey: string, bucketName: string, fileName: string): Promise<Uint8Array | null> {
  const auth = await authorizeB2(keyId, applicationKey);
  const url = `${auth.downloadUrl}/file/${encodeURIComponent(bucketName)}/${encodeURI(fileName)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: auth.authorizationToken } });
  } catch {
    throw new Error('B2 file download failed before receiving a response.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 file download failed with HTTP ${res.status}.`);
  return new Uint8Array(await res.arrayBuffer());
}
