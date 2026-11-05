/**
 * @file srklCore.ts
 * @description Universal SRKL Ecosystem Service for Qwnsr.
 * Governs primary SRKL node lookup, account discovery via Unified DB & SRKL API, and B2 bucket access.
 */

import { queryUnifiedDb } from './unifiedDb';
import { b2ListBuckets } from './b2DirectCore';
import { createSrklClient } from '../srkl/SrklClient';

let cachedSrklUrl: { url: string; expiresAt: number } | null = null;

export async function getPrimarySrklDeploymentUrl(env?: Record<string, unknown>): Promise<string> {
  if (cachedSrklUrl && Date.now() < cachedSrklUrl.expiresAt) return cachedSrklUrl.url;
  try {
    const res = await queryUnifiedDb(
      `SELECT url FROM "ultrst-srkl-deployments" WHERE is_active = true ORDER BY is_primary DESC, priority DESC, created_at ASC LIMIT 1`,
      [],
      env
    );
    if (res.rows.length > 0 && res.rows[0].url) {
      const url = res.rows[0].url.trim().replace(/\/+$/, '');
      cachedSrklUrl = { url, expiresAt: Date.now() + 10 * 60 * 1000 };
      return url;
    }
  } catch (err: any) {
    console.warn('[SrklCore] Deployment DB lookup fallback:', err.message);
  }
  const fallback = 'https://srkl-engine.vercel.app';
  cachedSrklUrl = { url: fallback, expiresAt: Date.now() + 10 * 60 * 1000 };
  return fallback;
}

function deduplicateAccounts(items: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const a of items) {
    if (!a) continue;
    const creds = a.credentials || a.metadata?.credentials || a;
    const keyId = (creds.keyId || creds.b2KeyId || creds.accessKeyId || '').trim();
    const token = (creds.token || creds.apiToken || creds.applicationKey || creds.b2ApplicationKey || '').trim();
    const sId = (a.serviceId || a.provider || '').toLowerCase().trim();
    const sig = keyId ? `key:${keyId}` : token ? `tok:${sId}:${token.slice(-12)}` : a.id ? `id:${a.id}` : `nam:${sId}:${a.name || a.label}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      if (a.id) seen.add(`id:${a.id}`);
      out.push(a);
    }
  }
  return out;
}

export async function getSrklAccounts(
  userId?: string,
  service?: string,
  env?: Record<string, unknown>,
  authToken?: string
): Promise<{ success: boolean; deploymentUrl: string; userId?: string; count: number; accounts: any[]; error?: string }> {
  const srklUrl = await getPrimarySrklDeploymentUrl(env);
  if (!userId || !authToken) {
    return { success: false, deploymentUrl: srklUrl, userId, count: 0, accounts: [], error: 'A verified Luth session is required to retrieve SRKL accounts.' };
  }
  try {
    const client = createSrklClient({ srklUrl, userId, token: authToken });
    const accounts = await client.fetchEcosystemAccounts({
      appId: 'kloks',
      appName: 'Kloks',
      categories: service?.toLowerCase().includes('cloudflare') ? ['deployment'] : ['storage'],
      requiredServices: service ? [service] : [],
    }, { timeoutMs: 6000 });
    const filtered = deduplicateAccounts(accounts);
    return { success: true, deploymentUrl: srklUrl, userId, count: filtered.length, accounts: filtered };
  } catch (err: any) {
    return { success: false, deploymentUrl: srklUrl, userId, count: 0, accounts: [], error: err?.message || 'SRKL account lookup failed.' };
  }
}

export async function listBackblazeBuckets(
  payload: any,
  rawUserId?: string,
  env?: Record<string, unknown>,
  authToken?: string
): Promise<{ success: boolean; buckets?: any[]; error?: string }> {
  try {
    const userId = rawUserId || payload?.userId || payload?.credentials?.userId || '';
    const creds = payload?.credentials || {};
    let keyId = (payload?.keyId || payload?.b2KeyId || payload?.accessKeyId || creds.keyId || creds.b2KeyId || creds.accessKeyId || '').trim();
    let appKey = (payload?.applicationKey || payload?.b2ApplicationKey || payload?.appKey || payload?.secretAccessKey || creds.applicationKey || creds.b2ApplicationKey || creds.appKey || creds.secretAccessKey || '').trim();
    const bucketId = (payload?.bucketId || creds.bucketId || '').trim();
    const bucketName = (payload?.bucketName || payload?.b2BucketName || creds.bucketName || creds.b2BucketName || '').trim();

    if ((!keyId || !appKey) && (payload?.accountId || payload?.id)) {
      const srkl = await getSrklAccounts(userId, 'backblaze', env, authToken);
      const matched = srkl.accounts?.find((a: any) => a.id === (payload.accountId || payload.id));
      if (matched?.credentials) {
        keyId = (matched.credentials.keyId || matched.credentials.b2KeyId || matched.credentials.accessKeyId || keyId).trim();
        appKey = (matched.credentials.applicationKey || matched.credentials.b2ApplicationKey || matched.credentials.appKey || matched.credentials.secretAccessKey || appKey).trim();
      }
    }

    if (!keyId || !appKey) return { success: false, error: 'Backblaze credentials (Key ID and Application Key) required.' };

    try {
      const buckets = await b2ListBuckets(keyId, appKey, bucketId || undefined, bucketName || undefined);
      if (Array.isArray(buckets) && buckets.length > 0) return { success: true, buckets };
    } catch (err: any) {
      console.warn('[SrklCore] Direct B2 bucket query failed, trying SRKL fallback:', err.message);
    }

    return { success: false, error: 'Direct Backblaze bucket lookup failed; SRKL credentials were not forwarded to a secondary endpoint.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to list Backblaze buckets' };
  }
}

export const srklListBackblazeBuckets = (
  keyId?: string,
  applicationKey?: string,
  bucketId?: string,
  bucketName?: string,
  userId?: string,
  accountId?: string,
  authToken?: string
) => listBackblazeBuckets({ keyId, applicationKey, bucketId, bucketName, accountId }, userId, undefined, authToken);

export async function getSrklStatus(env?: Record<string, unknown>) {
  const srklUrl = await getPrimarySrklDeploymentUrl(env);
  const start = Date.now();
  try {
    const resp = await fetch(`${srklUrl}/api/ecosystem/health`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - start;
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { success: true, deploymentUrl: srklUrl, online: true, latencyMs, details: data };
    }
    return { success: false, deploymentUrl: srklUrl, online: false, status: resp.status, latencyMs };
  } catch (err: any) {
    return { success: false, deploymentUrl: srklUrl, online: false, error: err.message, latencyMs: Date.now() - start };
  }
}
