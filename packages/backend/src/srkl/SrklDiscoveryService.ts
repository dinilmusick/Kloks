/**
 * @file SrklDiscoveryService.ts
 * @description Universal SRKL Service Discovery and Backblaze B2 account federation.
 * Runs identically in Node.js, Vercel Serverless, and Cloudflare Workers (< 200 lines).
 */

import { b2ListBuckets } from '../storage/B2DirectClient.js';

let cachedSrklUrl: { url: string; expiresAt: number } | null = null;

export async function getPrimarySrklDeploymentUrl(
  queryDb?: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
): Promise<string> {
  if (cachedSrklUrl && Date.now() < cachedSrklUrl.expiresAt) return cachedSrklUrl.url;

  if (queryDb) {
    try {
      const res = await queryDb(
        `SELECT url FROM "ultrst-srkl-deployments" WHERE is_active = true ORDER BY is_primary DESC, priority DESC, created_at ASC LIMIT 1`,
        []
      );
      if (res.rows.length > 0 && res.rows[0].url) {
        const url = res.rows[0].url.trim().replace(/\/+$/, '');
        cachedSrklUrl = { url, expiresAt: Date.now() + 10 * 60 * 1000 };
        return url;
      }
    } catch {}
  }

  const fallback = 'https://srkl-engine.vercel.app';
  cachedSrklUrl = { url: fallback, expiresAt: Date.now() + 10 * 60 * 1000 };
  return fallback;
}

export async function getSrklAccounts(
  userId: string,
  service?: string,
  queryDb?: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
): Promise<{ success: boolean; deploymentUrl: string; accounts: any[]; count: number; error?: string }> {
  const srklUrl = await getPrimarySrklDeploymentUrl(queryDb);
  const accounts: any[] = [];
  const seenKeys = new Set<string>();

  // 1. Check local user's app_profiles in DB for federated connections
  if (queryDb && userId) {
    try {
      const uRes = await queryDb(`SELECT app_profiles FROM "ultrst-users" WHERE id = $1 LIMIT 1`, [userId]);
      if (uRes.rows.length > 0) {
        const p = typeof uRes.rows[0].app_profiles === 'string' ? JSON.parse(uRes.rows[0].app_profiles) : (uRes.rows[0].app_profiles || {});
        const pool: any[] = [];
        for (const app of Object.values(p)) {
          if (app && typeof app === 'object' && Array.isArray((app as any).storage_connections)) {
            pool.push(...(app as any).storage_connections);
          }
        }
        for (const conn of pool) {
          if (service && !conn.provider?.toLowerCase().includes(service.toLowerCase())) continue;
          const kId = (conn.b2KeyId || conn.keyId || conn.accessKeyId || conn.googleEmail || '').trim();
          const key = kId ? `key:${kId}:${conn.googleRootFolderId || conn.b2BucketName || ''}` : `id:${conn.id}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            accounts.push({
              id: conn.id,
              name: conn.label || conn.id,
              provider: conn.provider,
              serviceId: conn.provider,
              credentials: {
                keyId: conn.b2KeyId || conn.keyId,
                applicationKey: conn.b2ApplicationKey || conn.appKey,
                bucketName: conn.b2BucketName || conn.bucketName,
                region: conn.b2Region || conn.region,
                endpoint: conn.b2Endpoint || conn.endpoint,
                email: conn.googleEmail,
                rootFolderId: conn.googleRootFolderId,
                rootFolderName: conn.googleRootFolderName,
                accessToken: conn.googleAccessToken,
                accessTokenExpiresAt: conn.googleAccessTokenExpiresAt,
                refreshToken: conn.googleRefreshToken,
              },
            });
          }
        }
      }
    } catch {}
  }

  // 2. Fetch from SRKL deployment HTTP endpoint
  try {
    const res = await fetch(`${srklUrl}/api/ecosystem/services`, {
      headers: { 'x-user-id': userId, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const list = Array.isArray(data.services) ? data.services : [];
      for (const item of list) {
        const sId = String(item.serviceId || item.id || '').toLowerCase();
        if (service && !sId.includes(service.toLowerCase())) continue;
        const kId = (item.credentials?.keyId || item.credentials?.b2KeyId || '').trim();
        const key = kId ? `key:${kId}` : `id:${item.id}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          accounts.push(item);
        }
      }
    }
  } catch {}

  return { success: true, deploymentUrl: srklUrl, count: accounts.length, accounts };
}

export async function srklListBackblazeBuckets(
  keyId?: string,
  applicationKey?: string,
  _bucketId?: string,
  _bucketName?: string,
  userId?: string,
  queryDb?: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  accountId?: string
): Promise<{ success: boolean; buckets: any[]; error?: string }> {
  let resolvedKeyId = (keyId || '').trim();
  let resolvedAppKey = (applicationKey || '').trim();

  if ((!resolvedKeyId || !resolvedAppKey) && (userId || accountId)) {
    const accountsRes = await getSrklAccounts(userId || '', 'backblaze', queryDb);
    const matched = accountsRes.accounts.find((a) => (accountId && a.id === accountId) || (resolvedKeyId && (a.credentials?.keyId || a.credentials?.b2KeyId) === resolvedKeyId)) || accountsRes.accounts[0];
    if (matched) {
      resolvedKeyId = matched.credentials?.keyId || matched.credentials?.b2KeyId || resolvedKeyId;
      resolvedAppKey = matched.credentials?.applicationKey || matched.credentials?.b2ApplicationKey || resolvedAppKey;
    }
  }

  if (!resolvedKeyId || !resolvedAppKey) {
    return { success: false, buckets: [], error: 'Backblaze B2 Key ID and Application Key are required' };
  }

  try {
    const buckets = await b2ListBuckets(resolvedKeyId, resolvedAppKey);
    return { success: true, buckets };
  } catch (err: any) {
    return { success: false, buckets: [], error: err.message };
  }
}
