/**
 * @file unifiedDb.ts
 * @description Canonical isomorphic database client using the Neon Serverless HTTP driver.
 * The normalized SYSTEM_DATABASE_URL contract is resolved in one shared location.
 */

import { tryResolveSystemDatabaseUrl } from '../resolver/systemDatabaseUrl.js';

let neon: any;

export interface UnifiedQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export function cleanDbUrl(url?: unknown): string {
  if (typeof url !== 'string') return '';
  return url.trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * A supplied runtime binding is authoritative. Do not silently fall back to
 * process.env when an explicit Worker binding object was provided: that can
 * conceal a missing deployment secret with a stale Node compatibility value.
 */
export function getUnifiedDbUrl(env?: Record<string, unknown>): string {
  if (env !== undefined) return tryResolveSystemDatabaseUrl(env) || '';
  return tryResolveSystemDatabaseUrl();
}

export async function queryUnifiedDb<T = any>(
  sqlText: string,
  params: any[] = [],
  env?: Record<string, unknown>,
): Promise<UnifiedQueryResult<T>> {
  const dbUrl = getUnifiedDbUrl(env);
  if (!dbUrl) {
    throw new Error(
      '[UnifiedDB] Missing system database configuration. ' +
      'Set SYSTEM_DATABASE_URL; SYSTEM_DATABASE_URL_2 and SYSTEM_DATABASE_URL_3 are optional failover URLs.',
    );
  }

  if (!neon) {
    const mod = await import('@neondatabase/serverless');
    neon = mod.neon;
  }

  const sql = neon(dbUrl);
  try {
    const rows = (await ((sql as any).query
      ? (sql as any).query(sqlText, params)
      : (sql as any)(sqlText, params))) as T[];
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowCount: Array.isArray(rows) ? rows.length : 0,
    };
  } catch (err: any) {
    // Never log the connection string or query parameters (which may contain secrets).
    console.error('[UnifiedDB] Query execution failed:', err?.message || 'unknown database error');
    throw err;
  }
}
