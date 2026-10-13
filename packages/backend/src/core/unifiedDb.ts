/**
 * @file unifiedDb.ts
 * @description Isomorphic Database Client using Neon Serverless HTTP driver for Qwnsr.
 * Operates identically across Node.js, Vercel Serverless, and Cloudflare Workers.
 */

import { neon } from '@neondatabase/serverless';

export interface UnifiedQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export function cleanDbUrl(url?: unknown): string {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/^["']|["']$/g, '');
}

export function getUnifiedDbUrl(env?: Record<string, unknown>): string {
  const fromEnv =
    cleanDbUrl(env?.SYSTEM_DATABASE_URL_1) ||
    cleanDbUrl(env?.DATABASE_URL) ||
    cleanDbUrl(env?.SYSTEM_DATABASE_URL_2);

  if (fromEnv) return fromEnv;

  if (typeof process !== 'undefined' && process.env) {
    return (
      cleanDbUrl(process.env.SYSTEM_DATABASE_URL_1) ||
      cleanDbUrl(process.env.DATABASE_URL) ||
      cleanDbUrl(process.env.SYSTEM_DATABASE_URL_2) ||
      cleanDbUrl(process.env.SYSTEM_DATABASE_URL_3) ||
      ''
    );
  }

  return '';
}

export async function queryUnifiedDb<T = any>(
  sqlText: string,
  params: any[] = [],
  env?: Record<string, unknown>
): Promise<UnifiedQueryResult<T>> {
  const dbUrl = getUnifiedDbUrl(env);
  if (!dbUrl) {
    throw new Error('[UnifiedDB] No database URL configured in environment.');
  }

  const sql = neon(dbUrl);
  try {
    const rows = (await ((sql as any).query ? (sql as any).query(sqlText, params) : (sql as any)(sqlText, params))) as T[];
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowCount: Array.isArray(rows) ? rows.length : 0,
    };
  } catch (err: any) {
    console.error('[UnifiedDB] Query execution error:', err.message);
    throw err;
  }
}
