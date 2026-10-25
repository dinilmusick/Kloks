import { describe, expect, it } from 'vitest';
import { StorageAdapterFactory } from '../packages/backend/src/storage/StorageAdapterFactory.js';
import { createGoogleDriveAuthorizationUrl } from '../packages/backend/src/storage/GoogleDriveOAuth.js';

describe('Google Drive workspace storage', () => {
  it('creates a PKCE-compatible authorization URL', () => {
    const url = createGoogleDriveAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://app.example/callback',
    }, 'state-123', 'challenge-456');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example/callback');
    expect(parsed.searchParams.get('state')).toBe('state-123');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-456');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('registers Google Drive as a storage provider', () => {
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      accessKey: 'test-token',
      rootFolderId: 'root',
    });
    expect(adapter.constructor.name).toBe('GoogleDriveAdapter');
  });
});
