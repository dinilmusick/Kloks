/**
 * Portable application-owned Luth discovery configuration. Skipo generates
 * skipo.config.json; Kloks receives the parsed value, never reads platform env.
 * These are service endpoints, NOT an allowlist of applications or origins.
 */
export interface SkipoLuthConfig {
  version: 1;
  authentication: { luthUrls: string[] };
}
export function parseSkipoLuthUrls(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SKIPO_AUTH_CONFIG_INVALID');
  }
  const config = value as Record<string, unknown>;
  const auth = config.authentication as Record<string, unknown> | undefined;
  const candidates = auth?.luthUrls;
  if (config.version !== 1 || !Array.isArray(candidates) ||
      candidates.length === 0 || candidates.length > 16) {
    throw new Error('SKIPO_AUTH_CONFIG_INVALID');
  }
  const urls: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length > 2048) {
      throw new Error('SKIPO_LUTH_URL_INVALID');
    }
    let url: URL;
    try { url = new URL(candidate); }
    catch { throw new Error('SKIPO_LUTH_URL_INVALID'); }
    const local = url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username ||
        url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('SKIPO_LUTH_URL_INVALID');
    }
    if (!urls.includes(url.origin)) urls.push(url.origin);
  }
  return urls;
}

/**
 * Ordered failover is safe for public, idempotent GET discovery/status calls.
 * OAuth authorization, code exchange and app-local sessions MUST remain pinned
 * to the issuer that created the flow; never replay their POSTs at other URLs.
 * 4xx responses are authoritative, not evidence of a failed worker.
 */
export async function fetchLuthPublicEndpoint(
  config: unknown,
  path: '/api/discovery/v1' | '/api/status' | '/api/health',
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const urls = parseSkipoLuthUrls(config);
  for (const origin of urls) {
    try {
      const response = await fetcher(origin + path, {
        method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (response.status >= 500 && response.status <= 599) continue;
      return response;
    } catch {
      // Only an unreachable transport may proceed to the next configured URL.
    }
  }
  throw new Error('LUTH_PUBLIC_ENDPOINTS_UNAVAILABLE');
}
