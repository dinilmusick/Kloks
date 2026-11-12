import { getGoogleSdk } from './googleDriveSdk.js';

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

/**
 * Server-only runtime dependencies. Keep this object out of persisted
 * provider connection records and never pass it to browser code.
 */
export interface GoogleDriveRuntimeAuthOptions {
  clientSecret?: string;
  getCredentials?: () => Promise<GoogleDriveTokenSet>;
  persistCredentials?: (tokens: GoogleDriveTokenSet) => Promise<void> | void;
}

/**
 * A storage root must be able to enumerate, read, create, update and delete
 * files below a user-selected existing folder. drive.file is deliberately
 * insufficient for this contract: it only covers files explicitly opened
 * or created by the application. The full Drive scope is therefore the
 * narrowest single scope that supports the complete storage abstraction.
 */
export const GOOGLE_DRIVE_STORAGE_SCOPE = 'https://www.googleapis.com/auth/drive';
/** @deprecated Use GOOGLE_DRIVE_STORAGE_SCOPE for complete storage roots. */
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function createOAuthClient(config: GoogleDriveOAuthConfig): Promise<any> {
  if (!config.clientId?.trim()) throw new Error('Google OAuth client ID is required.');
  if (!config.redirectUri?.trim()) throw new Error('Google OAuth redirect URI is required.');
  const google = await getGoogleSdk();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export function createGoogleDriveAuthorizationUrl(
  config: GoogleDriveOAuthConfig,
  state: string,
  codeChallenge?: string,
): string {
  if (!config.clientId?.trim()) throw new Error('Google OAuth client ID is required.');
  if (!config.redirectUri?.trim()) throw new Error('Google OAuth redirect URI is required.');
  if (!state?.trim()) throw new Error('A non-empty OAuth state value is required.');
  if (codeChallenge !== undefined && !codeChallenge.trim()) {
    throw new Error('PKCE code challenge cannot be empty.');
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: (config.scopes?.length ? config.scopes : [GOOGLE_DRIVE_STORAGE_SCOPE]).join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    ...(codeChallenge
      ? { code_challenge: codeChallenge, code_challenge_method: 'S256' }
      : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleDriveCode(
  config: GoogleDriveOAuthConfig,
  code: string,
  codeVerifier?: string,
  existingRefreshToken?: string,
): Promise<GoogleDriveTokenSet> {
  if (!code?.trim()) throw new Error('Google OAuth authorization code is required.');
  const client = await createOAuthClient(config);

  try {
    const { tokens } = await client.getToken({
      code,
      ...(codeVerifier ? { codeVerifier } : {}),
    });

    if (!tokens.access_token) {
      throw new Error('Google OAuth token exchange returned no access token.');
    }

    return {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token || existingRefreshToken
        ? { refreshToken: tokens.refresh_token || existingRefreshToken }
        : {}),
      ...(tokens.expiry_date ? { expiresAt: tokens.expiry_date } : {}),
      ...(tokens.token_type ? { tokenType: tokens.token_type } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Google OAuth token exchange returned no access token.') {
      throw error;
    }
    // Do not propagate provider request details that may contain credentials.
    throw new Error('Google OAuth authorization-code exchange failed.');
  }
}

export async function refreshGoogleDriveAccessToken(
  clientId: string,
  refreshToken: string,
  clientSecret?: string,
  redirectUri = 'http://localhost',
): Promise<GoogleDriveTokenSet> {
  if (!clientId?.trim() || !refreshToken?.trim()) {
    throw new Error('Google Drive refresh credentials are incomplete.');
  }

  const google = await getGoogleSdk();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });

  try {
    const { token } = await client.getAccessToken();
    const credentials = client.credentials;
    if (!token) throw new Error('Google OAuth refresh returned no access token.');

    return {
      accessToken: token,
      refreshToken: credentials.refresh_token || refreshToken,
      ...(credentials.expiry_date ? { expiresAt: credentials.expiry_date } : {}),
      ...(credentials.token_type ? { tokenType: credentials.token_type } : {}),
    };
  } catch {
    // Keep provider response bodies and request metadata out of application logs.
    throw new Error('Google Drive access-token refresh failed. Reauthorize the Google account if the refresh credential is invalid or revoked.');
  }
}
