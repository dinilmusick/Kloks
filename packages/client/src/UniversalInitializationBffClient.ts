import {
  createUniversalInitializationClient,
  DEFAULT_LUTH_URL,
  type UniversalAuthReadiness,
  type UniversalInitializationClient,
} from '@dinilmusick/gutts/auth';

/**
 * Browser adapter: public discovery always reaches pinned Luth. Configuration
 * is transparently fetched through the verified same-origin Kloks BFF, which
 * alone holds the OAuth access token. Neither browser nor native bundles can
 * receive server-side OAuth client secrets.
 */
export interface ApplicationUniversalInitializationOptions {
  appId: string;
  /** For local fixtures only; must be an exact HTTPS origin or loopback. */
  luthOrigin?: string;
  fetcher?: typeof fetch;
  onStateChange?: (state: UniversalAuthReadiness) => void;
}

export function createApplicationUniversalInitializationClient(
  options: ApplicationUniversalInitializationOptions,
): UniversalInitializationClient {
  const origin = new URL(options.luthOrigin ?? DEFAULT_LUTH_URL);
  if (origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== '/' ||
      (origin.protocol !== 'https:' &&
       !(origin.protocol === 'http:' &&
         ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('UNTRUSTED_LUTH_BOOTSTRAP');
  }
  const pinned = origin.origin;
  const network = options.fetcher ?? fetch;
  return createUniversalInitializationClient(
    { appId: options.appId, runtime: 'browser',
      discoveryUrl: pinned + '/api/discovery/v1' },
    {
      expectedIssuerOrigin: pinned,
      ...(options.onStateChange ? { onStateChange: options.onStateChange } : {}),
      fetcher: ((input: RequestInfo | URL, init?: RequestInit) => {
        const target = new URL(input instanceof Request ? input.url : String(input));
        if (target.origin !== pinned) {
          throw new Error('UNTRUSTED_LUTH_ENDPOINT');
        }
        if (target.pathname === '/api/config/v1') {
          if (target.searchParams.get('app_id') !== options.appId ||
              target.searchParams.size !== 1) {
            throw new Error('APP_IDENTITY_MISMATCH');
          }
          // No bearer header or arbitrary remote URL from browser JS.
          // Cookie is same-origin and remains HttpOnly.
          return network('/api/initialization/config', {
            method: 'GET', cache: 'no-store', credentials: 'include',
            redirect: 'error', headers: { accept: 'application/json' },
          });
        }
        return network(input, init);
      }) as typeof fetch,
    },
  );
}
