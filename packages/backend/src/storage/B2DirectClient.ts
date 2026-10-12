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
  const cacheKey = `${keyId}:${applicationKey}`;
  const cached = authCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const basic = btoa(`${keyId.trim()}:${applicationKey.trim()}`);
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`B2 Authorization failed: ${res.status} ${await res.text()}`);

  const data: any = await res.json();
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
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: auth.accountId }),
  });
  if (!res.ok) throw new Error(`B2 list buckets failed: ${res.status}`);
  const data: any = await res.json();
  return data.buckets || [];
}

export async function b2ListFileNames(keyId: string, applicationKey: string, bucketName: string, prefix = ''): Promise<any[]> {
  const auth = await authorizeB2(keyId, applicationKey);
  const buckets = await b2ListBuckets(keyId, applicationKey);
  const bucket = buckets.find((b: any) => b.bucketName === bucketName);
  if (!bucket) return [];

  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: bucket.bucketId, prefix, maxFileCount: 1000 }),
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  return data.files || [];
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
  if (!bucket) throw new Error(`Bucket ${bucketName} not found`);

  const urlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: bucket.bucketId }),
  });
  if (!urlRes.ok) throw new Error(`B2 get upload url failed: ${urlRes.status}`);
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
      'Content-Length': String(raw.length),
      'X-Bz-Content-Sha1': sha1,
    },
    body: raw as any,
  });
  if (!upRes.ok) throw new Error(`B2 upload failed: ${upRes.status} ${await upRes.text()}`);
  return await upRes.json();
}

export async function b2DownloadFile(keyId: string, applicationKey: string, bucketName: string, fileName: string): Promise<Uint8Array | null> {
  const auth = await authorizeB2(keyId, applicationKey);
  const url = `${auth.downloadUrl}/file/${bucketName}/${encodeURI(fileName)}`;
  const res = await fetch(url, { headers: { Authorization: auth.authorizationToken } });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}
