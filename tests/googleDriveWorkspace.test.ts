import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let refreshError: Error | null = null;
  const drive = {
    files: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    about: { get: vi.fn() },
  };

  class MockOAuth2 {
    credentials: Record<string, any> = {};
    listeners: Record<string, (tokens: Record<string, any>) => void> = {};
    constructor(
      readonly clientId?: string,
      readonly clientSecret?: string,
      readonly redirectUri?: string,
    ) {}
    on(event: string, listener: (tokens: Record<string, any>) => void) { this.listeners[event] = listener; return this; }
    setCredentials(credentials: Record<string, any>) { this.credentials = { ...credentials }; }
    generateAuthUrl(params: Record<string, any>) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, Array.isArray(value) ? value.join(' ') : String(value));
      }
      url.searchParams.set('client_id', this.clientId || '');
      url.searchParams.set('redirect_uri', this.redirectUri || '');
      return url.toString();
    }
    async getToken() {
      return { tokens: { access_token: 'access-token', expiry_date: 1_900_000_000_000 } };
    }
    async getAccessToken() {
      if (refreshError) throw refreshError;
      this.credentials = {
        ...this.credentials,
        access_token: 'fresh-access-token',
        expiry_date: 1_900_000_000_000,
      };
      this.listeners.tokens?.({ access_token: 'fresh-access-token', expiry_date: 1_900_000_000_000 });
      return { token: 'fresh-access-token' };
    }
  }

  const google = {
    auth: { OAuth2: MockOAuth2 },
    drive: vi.fn(() => drive),
  };
  return { drive, MockOAuth2, google, setRefreshError: (error: Error | null) => { refreshError = error; } };
});

vi.mock('../packages/backend/src/storage/googleDriveSdk.js', () => ({
  getGoogleSdk: async () => mocks.google,
}));

const drive = mocks.drive;
const google = mocks.google;

import { StorageAdapterFactory } from '../packages/backend/src/storage/StorageAdapterFactory.js';
import {
  createGoogleDriveAuthorizationUrl,
  exchangeGoogleDriveCode,
  refreshGoogleDriveAccessToken,
  GOOGLE_DRIVE_STORAGE_SCOPE,
} from '../packages/backend/src/storage/GoogleDriveOAuth.js';

describe('canonical Google Drive storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setRefreshError(null);
  });

  it('requests the complete storage scope and carries OAuth state, redirect URI and PKCE', () => {
    const url = createGoogleDriveAuthorizationUrl({
      clientId: 'client-id',
      clientSecret: 'server-only-secret',
      redirectUri: 'https://app.example/callback',
    }, 'signed-state', 'pkce-challenge');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example/callback');
    expect(parsed.searchParams.get('state')).toBe('signed-state');
    expect(parsed.searchParams.get('scope')).toBe(GOOGLE_DRIVE_STORAGE_SCOPE);
    expect(parsed.searchParams.get('code_challenge')).toBe('pkce-challenge');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('client_secret')).toBeNull();
  });

  it('rejects authorization requests without state', () => {
    expect(() => createGoogleDriveAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://app.example/callback',
    }, '')).toThrow(/state/i);
  });

  it('exchanges an authorization code and preserves an existing refresh token', async () => {
    const tokens = await exchangeGoogleDriveCode({
      clientId: 'client-id',
      clientSecret: 'server-only-secret',
      redirectUri: 'https://app.example/callback',
    }, 'authorization-code', 'pkce-verifier', 'previous-refresh-token');

    expect(tokens.accessToken).toBe('access-token');
    expect(tokens.refreshToken).toBe('previous-refresh-token');
    expect(tokens.expiresAt).toBe(1_900_000_000_000);
  });

  it('refreshes an access token without discarding the long-lived refresh credential', async () => {
    const tokens = await refreshGoogleDriveAccessToken(
      'client-id',
      'refresh-token',
      'server-only-secret',
      'https://app.example/callback',
    );

    expect(tokens.accessToken).toBe('fresh-access-token');
    expect(tokens.refreshToken).toBe('refresh-token');
    expect(tokens.expiresAt).toBe(1_900_000_000_000);
  });

  it('surfaces invalid or revoked refresh credentials as a reauthorization error', async () => {
    mocks.setRefreshError(new Error('invalid_grant: refresh token revoked'));
    await expect(refreshGoogleDriveAccessToken(
      'client-id',
      'revoked-refresh-token',
      'server-only-secret',
      'https://app.example/callback',
    )).rejects.toThrow(/reauthorize/i);
  });

  it('constructs the canonical provider through StorageAdapterFactory with server-only credentials', async () => {
    drive.files.list.mockResolvedValue({ data: { files: [] } });
    const persistCredentials = vi.fn();
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleRedirectUri: 'https://app.example/callback',
      googleRootFolderId: 'root-folder',
      googleAccountId: 'account-subject',
    }, {
      googleDrive: {
        clientSecret: 'server-only-secret',
        getCredentials: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
        persistCredentials,
      },
    });

    expect(adapter.constructor.name).toBe('GoogleDriveStorageService');
    await adapter.list('');
    expect(google.drive).toHaveBeenCalledWith(expect.objectContaining({ version: 'v3' }));
    expect(persistCredentials).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-access-token',
      refreshToken: 'refresh-token',
    }));
  });

  it('keeps OAuth client secrets out of serializable provider connection metadata', () => {
    const connection = {
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleAccountId: 'google-account',
      googleRootFolderId: 'root-folder',
    };
    const serialized = JSON.stringify(connection);
    expect(serialized).toContain('google-account');
    expect(serialized).not.toContain('clientSecret');
    expect(serialized).not.toContain('refreshToken');
    expect(serialized).not.toContain('accessToken');
  });

  it('binds the provider connection to the stable authenticated Google account identity', async () => {
    drive.about.get.mockResolvedValue({
      data: { user: { permissionId: 'google-permission-id', emailAddress: 'user@example.com' } },
    });
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
    }, {
      googleDrive: { getCredentials: async () => ({ accessToken: 'access-token' }) },
    }) as any;

    await expect(adapter.getAccountIdentity()).resolves.toEqual({
      accountId: 'google-permission-id',
      email: 'user@example.com',
    });
    expect(adapter['config'].googleAccountId).toBe('google-permission-id');
  });

  it('rejects a Google account identity that differs from the saved connection owner', async () => {
    drive.about.get.mockResolvedValue({
      data: { user: { permissionId: 'another-google-account' } },
    });
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleAccountId: 'saved-google-account',
    }, {
      googleDrive: { getCredentials: async () => ({ accessToken: 'access-token' }) },
    }) as any;

    await expect(adapter.getAccountIdentity()).rejects.toThrow(/does not match/i);
  });

  it('lists folders, validates selected folder IDs and uses the selected folder as the storage root', async () => {
    drive.files.list.mockResolvedValue({
      data: {
        files: [{
          id: 'child-folder',
          name: 'Projects',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root-folder'],
          modifiedTime: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    drive.files.get.mockResolvedValue({
      data: {
        id: 'selected-folder',
        name: 'Workspace',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
        modifiedTime: '2026-01-02T00:00:00.000Z',
      },
    });

    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleRootFolderId: 'root-folder',
    }, {
      googleDrive: {
        getCredentials: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
      },
    }) as any;

    const folders = await adapter.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ id: 'child-folder', name: 'Projects' });

    const selected = await adapter.selectRootFolder('selected-folder');
    expect(selected.id).toBe('selected-folder');
    expect(adapter.getConnectionMetadata()).toMatchObject({
      provider: 'google_drive',
      googleRootFolderId: 'selected-folder',
    });
    expect(JSON.stringify(adapter.getConnectionMetadata())).not.toMatch(/accessToken|refreshToken|clientSecret/);

    drive.files.list.mockClear();
    drive.files.list.mockResolvedValue({ data: { files: [] } });
    await adapter.list('');
    expect(drive.files.list.mock.calls[0][0].q).toContain("'selected-folder' in parents");
  });

  it('reads and updates existing files through the selected storage root', async () => {
    drive.files.list.mockResolvedValue({
      data: {
        files: [{
          id: 'existing-file',
          name: 'document.txt',
          mimeType: 'text/plain',
          size: '3',
          modifiedTime: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    drive.files.get.mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer });
    drive.files.update.mockResolvedValue({ data: { id: 'existing-file' } });

    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleRootFolderId: 'selected-root',
    }, {
      googleDrive: { getCredentials: async () => ({ accessToken: 'access-token' }) },
    });

    await expect(adapter.read('document.txt')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await adapter.write('document.txt', new Uint8Array([4, 5]), 'text/plain');
    expect(drive.files.update).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'existing-file',
      requestBody: expect.objectContaining({ name: 'document.txt', mimeType: 'text/plain' }),
    }));
  });

  it('creates new files under the selected storage root', async () => {
    drive.files.list.mockResolvedValue({ data: { files: [] } });
    drive.files.create.mockResolvedValue({ data: { id: 'new-file' } });
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleRootFolderId: 'selected-root',
    }, {
      googleDrive: { getCredentials: async () => ({ accessToken: 'access-token' }) },
    });

    await adapter.write('new-document.txt', 'hello', 'text/plain');
    expect(drive.files.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'new-document.txt',
        parents: ['selected-root'],
      }),
    }));
  });

  it('propagates Drive API authorization and service errors instead of reporting false absence', async () => {
    drive.files.list.mockRejectedValueOnce({ response: { status: 403 }, message: 'forbidden' });
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
    }, {
      googleDrive: { getCredentials: async () => ({ accessToken: 'access-token' }) },
    });
    await expect(adapter.list('')).rejects.toMatchObject({ response: { status: 403 } });
  });

  it('rejects non-folder selections', async () => {
    drive.files.get.mockResolvedValue({
      data: { id: 'file-id', name: 'notes.txt', mimeType: 'text/plain' },
    });
    const adapter = StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
    }, {
      googleDrive: { getCredentials: async () => ({ accessToken: 'access-token' }) },
    }) as any;

    await expect(adapter.resolveFolder('file-id')).rejects.toThrow(/not a folder/i);
    expect(google.drive).toHaveBeenCalledWith(expect.objectContaining({ version: 'v3' }));
    expect(drive.files.get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-id' }));
  });

  it('keeps existing local, B2 and S3 provider routing intact', () => {
    expect(StorageAdapterFactory.create({ provider: 'local_fs' }).constructor.name).toBe('LocalFSAdapter');
    expect(StorageAdapterFactory.create({ provider: 'b2' }).constructor.name).toBe('BackblazeB2Adapter');
    expect(StorageAdapterFactory.create({ provider: 's3' }).constructor.name).toBe('BucketStorageService');
    expect(StorageAdapterFactory.create({ provider: 's3_compatible' }).constructor.name).toBe('BucketStorageService');
  });
});
