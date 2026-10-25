import { createCanonicalAuthClient, type CanonicalAuthUser } from './CanonicalAuthClient.js';

export interface SystemUser extends CanonicalAuthUser {
  username: string;
  role: string;
  status: string;
  appProfiles?: Record<string, unknown>;
}

export interface AuthEnvironment {
  SRKL_AUTH_BASE_URL?: string;
  [key: string]: unknown;
}

function requireAuthBaseUrl(env?: AuthEnvironment): string {
  const baseUrl = String(env?.SRKL_AUTH_BASE_URL ?? (typeof process !== 'undefined' ? process.env.SRKL_AUTH_BASE_URL : '') ?? '').trim();
  if (!baseUrl) {
    throw new Error('SRKL_AUTH_BASE_URL is required. Local application auth is not supported.');
  }
  return baseUrl;
}

export async function loginSystemUser(
  email: string,
  rawPass: string,
  isAdmin: boolean,
  _queryDb: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  env?: AuthEnvironment,
): Promise<{ success: boolean; status: number; token?: string; user?: SystemUser; error?: string }> {
  if (!email?.trim() || !rawPass) return { success: false, status: 400, error: 'Email and password are required' };

  try {
    const client = createCanonicalAuthClient(requireAuthBaseUrl(env));
    const result = await client.signInEmail(email, rawPass);
    if (!result.success || !result.user) {
      return { success: false, status: result.status, error: result.error ?? 'Invalid email or password' };
    }
    if (isAdmin && result.user.role !== 'admin') {
      return { success: false, status: 403, error: 'Insufficient administrative privileges' };
    }
    return {
      success: true,
      status: result.status,
      user: {
        ...result.user,
        username: result.user.username ?? result.user.email.split('@')[0],
        role: result.user.role ?? 'user',
        status: result.user.status ?? 'ACTIVE',
      },
      token: typeof result.session?.token === 'string' ? result.session.token : undefined,
    };
  } catch (error) {
    return { success: false, status: 503, error: error instanceof Error ? error.message : 'Canonical authentication service unavailable' };
  }
}

export async function resolveUserFromToken(
  tokenOrUserId: string,
  _queryDb: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  env?: AuthEnvironment,
): Promise<SystemUser | null> {
  if (!tokenOrUserId) return null;
  try {
    const client = createCanonicalAuthClient(requireAuthBaseUrl(env));
    const credential = tokenOrUserId.trim();
    if (!credential) return null;

    // Accept a raw Better Auth session token or an explicit Bearer token. A user ID
    // is not a credential and must never be treated as proof of authentication.
    const token = credential.replace(/^Bearer[ \t]+/i, '').trim();
    if (!token) return null;
    const session = await client.getSession(`better-auth.session_token=${token}`);
    if (!session?.user) return null;
    return {
      ...session.user,
      username: session.user.username ?? session.user.email.split('@')[0],
      role: session.user.role ?? 'user',
      status: session.user.status ?? 'ACTIVE',
    };
  } catch {
    return null;
  }
}
