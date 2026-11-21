import { DEFAULT_LUTH_URL } from '@dinilmusick/gutts/auth';

export interface OfficialLuthUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Resource-server OAuth authentication: official live UserInfo only.
 * No password grant, synthetic local session, x-api-key or Origin authority.
 */
export async function verifyLuthOAuthAccessToken(
  token: string,
  transport: typeof fetch = fetch,
): Promise<OfficialLuthUser | null> {
  const clean = token.trim().replace(/^Bearer\s+/i, '');
  if (!/^[A-Za-z0-9._~-]{16,2048}$/.test(clean)) return null;
  try {
    const issuer = new URL(DEFAULT_LUTH_URL);
    const result = await transport(
      new URL('/api/auth/oauth2/userinfo', issuer.origin), {
        method: 'GET', credentials: 'omit', cache: 'no-store',
        redirect: 'error',
        headers: { authorization: 'Bearer ' + clean, accept: 'application/json' },
      },
    );
    if (!result.ok) return null;
    const body = await result.json() as Record<string, unknown>;
    if (typeof body.sub !== 'string' || !body.sub ||
        typeof body.email !== 'string' || !body.email) return null;
    return {
      id: body.sub, email: body.email,
      name: typeof body.name === 'string' ? body.name : body.email,
    };
  } catch { return null; }
}
