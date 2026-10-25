export interface CanonicalAuthUser {
  id: string;
  email: string;
  name: string;
  username?: string;
  role?: string;
  status?: string;
  appProfiles?: Record<string, unknown>;
  emailVerified?: boolean;
}

export interface CanonicalAuthSession {
  session: Record<string, unknown>;
  user: CanonicalAuthUser;
}

export interface CanonicalAuthClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  credentials?: RequestCredentials;
}

export interface AuthResult {
  success: boolean;
  status: number;
  user?: CanonicalAuthUser;
  session?: Record<string, unknown>;
  error?: string;\n  redirectUrl?: string;
}

const cleanBaseUrl = (value: string) => value.trim().replace(/\\/+$/, '');

export class CanonicalAuthClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly credentials: RequestCredentials;

  constructor(options: CanonicalAuthClientOptions) {
    if (!options.baseUrl?.trim()) throw new Error('Canonical auth base URL is required.');
    this.baseUrl = cleanBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
    this.credentials = options.credentials ?? 'include';
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
    const response = await this.fetcher(`${this.baseUrl}/api/auth${path}`, {
      ...init,
      credentials: this.credentials,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    return { status: response.status, data };
  }

  async signInEmail(email: string, password: string): Promise<AuthResult> {
    const result = await this.request<any>('/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (result.status >= 400 || result.data?.error) {
      return { success: false, status: result.status, error: result.data?.error?.message ?? result.data?.message ?? 'Authentication failed.' };
    }
    return { success: true, status: result.status, user: result.data?.user, session: result.data?.session, redirectUrl: result.data?.url ?? result.data?.redirect };
  }

  async signUpEmail(email: string, password: string, name: string): Promise<AuthResult> {
    const result = await this.request<any>('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password, name: name.trim() }),
    });
    if (result.status >= 400 || result.data?.error) {
      return { success: false, status: result.status, error: result.data?.error?.message ?? result.data?.message ?? 'Registration failed.' };
    }
    return { success: true, status: result.status, user: result.data?.user, session: result.data?.session };
  }

  async signInGoogle(callbackURL: string): Promise<AuthResult> {
    const result = await this.request<any>('/sign-in/social', {
      method: 'POST',
      body: JSON.stringify({ provider: 'google', callbackURL }),
    });
    if (result.status >= 400 || result.data?.error) {
      return { success: false, status: result.status, error: result.data?.error?.message ?? result.data?.message ?? 'Google sign-in failed.' };
    }
    return { success: true, status: result.status, user: result.data?.user, session: result.data?.session };
  }

  async requestGoogleDriveAccess(callbackURL?: string): Promise<AuthResult> {
    const result = await this.request<any>('/link-social', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'google',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
        ...(callbackURL ? { callbackURL } : {}),
      }),
    });
    if (result.status >= 400 || result.data?.error) {
      return { success: false, status: result.status, error: result.data?.error?.message ?? result.data?.message ?? 'Google Drive authorization failed.' };
    }
    return { success: true, status: result.status, user: result.data?.user, session: result.data?.session };
  }

  async getSession(cookie?: string): Promise<CanonicalAuthSession | null> {
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    const result = await this.request<any>('/get-session', { headers });
    if (result.status >= 400 || !result.data?.user) return null;
    return result.data;
  }

  async signOut(): Promise<boolean> {
    const result = await this.request<any>('/sign-out', { method: 'POST', body: '{}' });
    return result.status < 400 && !result.data?.error;
  }
}

export function createCanonicalAuthClient(baseUrl: string, fetcher?: typeof fetch) {
  return new CanonicalAuthClient({ baseUrl, fetcher });
}
