/**
 * @file systemDatabaseUrl.ts
 * @description The canonical system database URL contract for all runtime targets.
 *
 * SYSTEM_DATABASE_URL is the primary and required deployment binding.
 * SYSTEM_DATABASE_URL_2 and SYSTEM_DATABASE_URL_3 are ordered failover URLs.
 * Generic DATABASE_URL and the retired SYSTEM_DATABASE_URL_1 alias are not accepted.
 */

export type SystemDatabaseEnvironment = Record<string, unknown>;

function normalizeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

function getRuntimeEnvironment(): SystemDatabaseEnvironment {
  if (typeof process !== 'undefined' && process.env) return process.env;
  return {};
}

/** Resolve the primary system database URL, followed by the supported failover URLs. */
export function tryResolveSystemDatabaseUrl(
  env: SystemDatabaseEnvironment = getRuntimeEnvironment(),
): string | null {
  return (
    normalizeUrl(env.SYSTEM_DATABASE_URL) ||
    normalizeUrl(env.SYSTEM_DATABASE_URL_2) ||
    normalizeUrl(env.SYSTEM_DATABASE_URL_3) ||
    null
  );
}

/** Resolve the configured system database or return a deterministic configuration error. */
export function resolveSystemDatabaseUrl(
  env: SystemDatabaseEnvironment = getRuntimeEnvironment(),
): string {
  const url = tryResolveSystemDatabaseUrl(env);
  if (url) return url;

  throw new Error(
    '[SKIPO DATABASE_INVARIANT] Missing system database configuration. ' +
    'Set SYSTEM_DATABASE_URL (primary), SYSTEM_DATABASE_URL_2, or SYSTEM_DATABASE_URL_3. ' +
    'DATABASE_URL and SYSTEM_DATABASE_URL_1 are not supported configuration aliases.',
  );
}
