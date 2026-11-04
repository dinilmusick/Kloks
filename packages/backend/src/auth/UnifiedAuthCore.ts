import {
  LuthAuthClient,
  type LuthAuthTokenStore,
  type LuthSessionResult,
} from '@dinilmusick/gutts';

export interface SystemUser {
  id: string;
  email: string;
  name: string;
  username: string;
  role: string;
  status: string;
  appProfiles?: Record<string, unknown>;
  emailVerified?: boolean;
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

function tokenStore(initial = ''): LuthAuthTokenStore {
  let token = initial;
  return {
    get: () => token,
    set: (value) => { token = value; },
    clear: () => { token = ''; },
  };
}

function createClient(env: AuthEnvironment | undefined, token = ''): LuthAuthClient {
  return new LuthAuthClient({
    ecosystemId: 'ultrst-armada',
    applicationId: 'kloks-backend',
    luthUrl: requireAuthBaseUrl(env),
    autoRegister: false,
    tokenStore: tokenStore(token),
  });
}

function toSystemUser(user: NonNullable<LuthSessionResult['user']>): SystemUser {
  return {
    ...user,
    username: user.email.split('@')[0],
    role: 'user',
    status: 'ACTIVE',
  };
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
    const client = createClient(env);
    const result = await client.signInWithEmail({ email: email.trim(), password: rawPass });
    const session = await client.getSession();
    if (!session.authenticated || !session.user || !session.session) {
      return { success: false, status: 401, error: 'Canonical authentication service did not establish a session.' };
    }
    const user = toSystemUser(session.user);
    if (isAdmin) {
      return { success: false, status: 403, error: 'Administrative authentication is not provided by canonical Luth user login.' };
    }
    return {
      success: true,
      status: 200,
      user,
      token: session.session.token,
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
    const credential = tokenOrUserId.trim().replace(/^Bearer[ \t]+/i, '').trim();
    if (!credential) return null;
    const client = createClient(env, credential);
    const session = await client.getSession();
    if (!session.authenticated || !session.user) return null;
    return toSystemUser(session.user);
  } catch {
    return null;
  }
}
