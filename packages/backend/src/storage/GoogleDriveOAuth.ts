import { google } from '@dinilmusick/gutts/storage';

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

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function createGoogleDriveAuthorizationUrl(
  config: GoogleDriveOAuthConfig,
  state: string,
  codeChallenge?: string,
): string {
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: config.scopes?.length ? config.scopes : [GOOGLE_DRIVE_FILE_SCOPE],
    state,
    ...(codeChallenge
      ? { code_challenge: codeChallenge, code_challenge_method: 'S256' }
      : {}),
  });

  return url;
}

export async function exchangeGoogleDriveCode(
  config: GoogleDriveOAuthConfig,
  code: string,
  codeVerifier?: string,
): Promise<GoogleDriveTokenSet> {
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );

  const { tokens } = await client.getToken({
    code,
    ...(codeVerifier ? { codeVerifier } : {}),
  });

  if (!tokens.access_token) {
    throw new Error('Google OAuth token exchange returned no access token.');
  }

  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.expiry_date ? { expiresAt: tokens.expiry_date } : {}),
    ...(tokens.token_type ? { tokenType: tokens.token_type } : {}),
  };
}

export async function refreshGoogleDriveAccessToken(
  clientId: string,
  refreshToken: string,
  clientSecret?: string,
  redirectUri?: string,
): Promise<GoogleDriveTokenSet> {
  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );
  client.setCredentials({ refresh_token: refreshToken });

  const accessToken = await client.getAccessToken();
  if (!accessToken.token) {
    throw new Error('Google OAuth refresh returned no access token.');
  }

  return {
    accessToken: accessToken.token,
    ...(client.credentials.expiry_date
      ? { expiresAt: client.credentials.expiry_date }
      : {}),
    ...(client.credentials.token_type
      ? { tokenType: client.credentials.token_type }
      : {}),
  };
}
