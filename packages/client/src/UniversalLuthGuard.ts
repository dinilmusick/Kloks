import { DEFAULT_LUTH_URL } from '@dinilmusick/gutts/auth';

export interface LuthPrincipal {
  id: string;
  email: string;
  name: string;
  role: 'user';
}

export const CANONICAL_PUBLIC_ROUTES: (string | RegExp)[] = [
  '/health', '/api/health', '/api/status',
  '/api/auth/oidc/start', '/api/auth/oidc/callback',
  '/api/auth/oidc/session', '/api/auth/oidc/logout',
  /^\/api(\/v1)?\/database\/status$/,
  /^\/api(\/v1)?\/guest(\/.*)?$/,
  /^\/api(\/v1)?\/spec(\/.*)?$/,
];

/** Never interpret a cookie, API key, user ID or Origin as a Luth token. */
export function extractLuthToken(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._~-]{16,2048})$/i.exec(authorization.trim());
  return match?.[1] || '';
}
export function isPublicRoute(
  path: string, extraPublicRoutes: (string | RegExp)[] = [],
): boolean {
  return [...CANONICAL_PUBLIC_ROUTES, ...extraPublicRoutes].some(route =>
    typeof route === 'string' ? route === path : route.test(path));
}
function deny(request: Request, unavailable = false): Response {
  const mcp = new URL(request.url).pathname.includes('/mcp');
  const status = unavailable ? 503 : 401;
  const message = unavailable ? 'Luth OAuth provider unavailable.' :
    'Valid OAuth 2.1 Bearer token required.';
  return Response.json(mcp ? {
    jsonrpc: '2.0', id: null,
    error: { code: unavailable ? -32603 : -32001, message },
  } : { success: false, error: message }, {
    status, headers: { 'cache-control': 'no-store' },
  });
}

/**
 * Verify the official OAuth Provider token on every protected request.
 * Never forward an application cookie; never cache identity across revocation.
 */
export async function verifyLuthRequest(
  request: Request,
  options?: { luthUrl?: string; extraPublicRoutes?: (string | RegExp)[] },
): Promise<LuthPrincipal | Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === 'OPTIONS' ||
      isPublicRoute(path, options?.extraPublicRoutes)) return null;
  const token = extractLuthToken(request);
  if (!token) return deny(request);
  try {
    const issuer = new URL(options?.luthUrl || DEFAULT_LUTH_URL);
    if (issuer.protocol !== 'https:') return deny(request, true);
    const response = await fetch(new URL('/api/auth/oauth2/userinfo', issuer.origin), {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) return deny(request);
    if (!response.ok) return deny(request, true);
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.sub !== 'string' || !body.sub ||
        typeof body.email !== 'string' || !body.email) return deny(request);
    return {
      id: body.sub,
      email: body.email,
      name: typeof body.name === 'string' && body.name ? body.name : body.email,
      role: 'user',
    };
  } catch {
    return deny(request, true);
  }
}
