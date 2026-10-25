export interface GoogleDriveOAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
}

export interface GoogleDriveTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function createGoogleDriveAuthorizationUrl(
  config: GoogleDriveOAuthConfig,
  state: string,
  codeChallenge?: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: (config.scopes || ['https://www.googleapis.com/auth/drive.file']).join(' '),
    state,
  });
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleDriveCode(
  config: GoogleDriveOAuthConfig,
  code: string,
  codeVerifier?: string,
): Promise<GoogleDriveTokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
    grant_type: 'authorization_code',
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed: ${response.status}`);
  const data = await response.json() as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    tokenType: data.token_type,
  };
}

export async function refreshGoogleDriveAccessToken(clientId: string, refreshToken: string): Promise<GoogleDriveTokenSet> {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Google OAuth refresh failed: ${response.status}`);
  const data = await response.json() as any;
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    tokenType: data.token_type,
  };
}
