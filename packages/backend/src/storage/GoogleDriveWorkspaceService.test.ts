import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_DRIVE_WORKSPACE_SCOPE,
  GoogleDriveWorkspaceService,
} from './GoogleDriveWorkspaceService.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetch-native canonical Google Drive workspace service', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a server-side OAuth URL with full storage scope and signed state', () => {
    const url = new URL(GoogleDriveWorkspaceService.createAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://app.example.test/api/workspaces/storage/google/callback',
    }, 'signed-state'));

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/api/workspaces/storage/google/callback');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_DRIVE_WORKSPACE_SCOPE);
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  it('exchanges an authorization code and preserves an existing refresh token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      access_token: 'access-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }));
    const tokens = await GoogleDriveWorkspaceService.exchangeAuthorizationCode({
      clientId: 'client-id',
      clientSecret: 'server-secret',
      redirectUri: 'https://app.example.test/callback',
      fetcher,
    }, 'authorization-code', 'existing-refresh-token');

    expect(tokens).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'existing-refresh-token',
      tokenType: 'Bearer',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refreshes tokens before Drive calls and persists refreshed credentials', async () => {
    const persistTokens = vi.fn();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        user: { permissionId: 'google-account', emailAddress: 'user@example.test' },
      }));
    const service = new GoogleDriveWorkspaceService({
      clientId: 'client-id',
      clientSecret: 'server-secret',
      redirectUri: 'https://app.example.test/callback',
      tokens: { accessToken: 'expired-token', refreshToken: 'refresh-token', expiresAt: Date.now() - 1 },
      fetcher,
      persistTokens,
    });

    await expect(service.getAccountIdentity()).resolves.toEqual({
      accountId: 'google-account',
      email: 'user@example.test',
    });
    expect(persistTokens).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-token',
      refreshToken: 'refresh-token',
    }));
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  });

  it('lists folders and validates a selected folder through the Drive REST boundary', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        files: [{
          id: 'folder-1',
          name: 'Projects',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root'],
          modifiedTime: '2026-10-01T00:00:00.000Z',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'folder-2',
        name: 'Workspace',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
      }));
    const service = new GoogleDriveWorkspaceService({
      clientId: 'client-id',
      redirectUri: 'https://app.example.test/callback',
      tokens: { accessToken: 'access-token' },
      fetcher,
    });

    await expect(service.listFolders()).resolves.toMatchObject([
      { id: 'folder-1', name: 'Projects', parentIds: ['root'] },
    ]);
    await expect(service.selectRootFolder('folder-2')).resolves.toMatchObject({
      id: 'folder-2',
      name: 'Workspace',
    });
    expect(service.getConnectionMetadata()).toMatchObject({
      provider: 'google_drive',
      googleRootFolderId: 'folder-2',
    });
  });

  it('rejects a selected Drive file instead of treating it as a storage root', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: 'file-1',
      name: 'notes.txt',
      mimeType: 'text/plain',
    }));
    const service = new GoogleDriveWorkspaceService({
      clientId: 'client-id',
      redirectUri: 'https://app.example.test/callback',
      tokens: { accessToken: 'access-token' },
      fetcher,
    });

    await expect(service.resolveFolder('file-1')).rejects.toThrow(/not a folder/i);
  });

  it('surfaces missing refresh credentials and OAuth exchange failures safely', async () => {
    const expired = new GoogleDriveWorkspaceService({
      clientId: 'client-id',
      redirectUri: 'https://app.example.test/callback',
      tokens: { accessToken: 'expired-token', expiresAt: Date.now() - 1 },
      fetcher: vi.fn<typeof fetch>(),
    });
    await expect(expired.getAccountIdentity()).rejects.toThrow(/reconnect/i);

    const failedExchange = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(GoogleDriveWorkspaceService.exchangeAuthorizationCode({
      clientId: 'client-id',
      redirectUri: 'https://app.example.test/callback',
      fetcher: failedExchange,
    }, 'bad-code')).rejects.toThrow(/invalid_grant/);
  });
});
