/**
 * @file unifiedDb.ts
 * @description Canonical isomorphic database client using the Neon Serverless HTTP driver.
 * The normalized SYSTEM_DATABASE_URL contract is resolved in one shared location.
 */

import { tryResolveSystemDatabaseUrl } from '../resolver/systemDatabaseUrl.js';

let neon: any;
type SystemEnvironmentResolver = () => Record<string, unknown>;
let defaultSystemEnvironmentResolver: SystemEnvironmentResolver | null = null;

/** Installed only by the explicit Node backend entrypoint. */
export function configureUnifiedDatabaseEnvironmentResolver(
  resolver: SystemEnvironmentResolver | null,
): void {
  defaultSystemEnvironmentResolver = resolver;
}

function defaultSystemEnvironment(): Record<string, unknown> {
  return defaultSystemEnvironmentResolver?.() || {};
}

export interface UnifiedQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export function cleanDbUrl(url?: unknown): string {
  if (typeof url !== 'string') return '';
  return url.trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Fully normalized Worker/Fetch env objects carry all three canonical keys,
 * even when unset. Such an object is authoritative and must not be masked by
 * process.env. Partial service context objects (for example {WORKSPACE_APP_ID})
 * retain the Node compatibility fallback used by existing callers.
 */
export function getUnifiedDbUrl(env?: Record<string, unknown>): string {
  const supplied = env || {};
  const hasCanonicalBindings = [
    'SYSTEM_DATABASE_URL',
    'SYSTEM_DATABASE_URL_2',
    'SYSTEM_DATABASE_URL_3',
  ].some((key) => Object.prototype.hasOwnProperty.call(supplied, key));

  // A complete Fetch binding object is authoritative, including explicit
  // undefined values. Partial service contexts may inherit only the Node
  // resolver installed by /backend/node; Worker builds have no such resolver.
  const effective = env === undefined
    ? defaultSystemEnvironment()
    : hasCanonicalBindings
      ? supplied
      : { ...defaultSystemEnvironment(), ...supplied };
  return tryResolveSystemDatabaseUrl(effective) || '';
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
