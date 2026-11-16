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


/**
 * Normalize the canonical system bindings at a Fetch entrypoint boundary.
 * This helper is intentionally runtime-neutral: Node callers pass process.env
 * as runtimeEnvironment; Workers pass their bindings as env and no Node
 * environment. It copies only system-owned configuration keys from the
 * runtime environment and preserves all application-provided env bindings.
 */
export function normalizeSystemEnvironment<T extends Record<string, unknown>>(
  env: T = {} as T,
  runtimeEnvironment: Record<string, unknown> = {},
  requestUrl?: string,
): T & Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...env };

  for (const key of ['SYSTEM_DATABASE_URL', 'SYSTEM_DATABASE_URL_2', 'SYSTEM_DATABASE_URL_3']) {
    const value = normalizeUrl(env[key]) || normalizeUrl(runtimeEnvironment[key]);
    if (value) normalized[key] = value;
    else if (Object.prototype.hasOwnProperty.call(env, key)) normalized[key] = undefined;
  }

  const configuredAppUrl = normalizeUrl(env.APP_URL) || normalizeUrl(runtimeEnvironment.APP_URL);
  if (configuredAppUrl) {
    normalized.APP_URL = configuredAppUrl;
  } else if (requestUrl) {
    try {
      normalized.APP_URL = new URL(requestUrl).origin;
    } catch {
      // Invalid request URLs are not allowed to replace configured system state.
    }
  }

  return normalized as T & Record<string, unknown>;
}
