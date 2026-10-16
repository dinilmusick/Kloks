/**
 * @file systemDatabaseUrl.ts
 * @description Centralized SYSTEM_DATABASE_URL resolver adhering to SKIPO Invariant §16.
 * Precedence: SYSTEM_DATABASE_URL_1 (primary) > SYSTEM_DATABASE_URL_2 (fallback #1) > SYSTEM_DATABASE_URL_3 (fallback #2).
 * Strictly forbids fallback to generic DATABASE_URL.
 */

/**
 * Resolves the active system database URL following the strict 1 -> 2 -> 3 precedence.
 * Throws a deterministic descriptive error if no system database URL is configured.
 *
 * @param env - Environment record (defaults to process.env in Node runtime)
 * @returns Validated system database connection string
 */
export function resolveSystemDatabaseUrl(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): string {
  const url =
    (env['SYSTEM_DATABASE_URL_1'] && env['SYSTEM_DATABASE_URL_1'].trim()) ||
    (env['SYSTEM_DATABASE_URL_2'] && env['SYSTEM_DATABASE_URL_2'].trim()) ||
    (env['SYSTEM_DATABASE_URL_3'] && env['SYSTEM_DATABASE_URL_3'].trim());

  if (!url) {
    throw new Error(
      '[SKIPO DATABASE_INVARIANT] Missing system database configuration.\n' +
      '  Set SYSTEM_DATABASE_URL_1 (primary), SYSTEM_DATABASE_URL_2 (fallback #1),\n' +
      '  or SYSTEM_DATABASE_URL_3 (fallback #2).\n' +
      '  Generic DATABASE_URL is obsolete and strictly forbidden in this architecture.'
    );
  }

  return url;
}

/**
 * Safe version that returns null instead of throwing if unconfigured.
 */
export function tryResolveSystemDatabaseUrl(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): string | null {
  const url =
    (env['SYSTEM_DATABASE_URL_1'] && env['SYSTEM_DATABASE_URL_1'].trim()) ||
    (env['SYSTEM_DATABASE_URL_2'] && env['SYSTEM_DATABASE_URL_2'].trim()) ||
    (env['SYSTEM_DATABASE_URL_3'] && env['SYSTEM_DATABASE_URL_3'].trim());

  return url || null;
}
