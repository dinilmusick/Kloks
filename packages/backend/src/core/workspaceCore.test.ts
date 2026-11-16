import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCanonicalWorkspaceFolderName } from '../workspace/WorkspaceCanonical.js';
import { resolveWorkspaceConnection } from './workspaceBucketSyncCore.js';
import { getWorkspaceFolderPrefix, normalizeWorkspaceStoragePath } from './workspaceFileCore.js';

const workspaceMocks = vi.hoisted(() => ({
  queryUnifiedDb: vi.fn(),
  resolveUserStorageConnectionSecret: vi.fn(),
  listUserStorageConnections: vi.fn(),
  testBackblazeCredentials: vi.fn(),
  createGoogleDriveWorkspaceClient: vi.fn(),
  syncWorkspaceCreateToBucket: vi.fn(),
  syncWorkspaceDeleteToBucket: vi.fn(),
}));

vi.mock('./unifiedDb.js', () => ({
  queryUnifiedDb: workspaceMocks.queryUnifiedDb,
}));
vi.mock('./storageConnectionCore.js', () => ({
  resolveUserStorageConnectionSecret: workspaceMocks.resolveUserStorageConnectionSecret,
  listUserStorageConnections: workspaceMocks.listUserStorageConnections,
  testBackblazeCredentials: workspaceMocks.testBackblazeCredentials,
  createGoogleDriveWorkspaceClient: workspaceMocks.createGoogleDriveWorkspaceClient,
}));
vi.mock('./workspaceBucketSyncCore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspaceBucketSyncCore.js')>();
  return {
    ...actual,
    syncWorkspaceCreateToBucket: workspaceMocks.syncWorkspaceCreateToBucket,
    syncWorkspaceDeleteToBucket: workspaceMocks.syncWorkspaceDeleteToBucket,
  };
});

import { findUserWorkspace } from './workspaceCore.js';


describe('workspace application scoping', () => {
  it('uses an application namespace for canonical workspace folders', () => {
    expect(formatCanonicalWorkspaceFolderName('aiko', 'User One', 'Main')).toBe('ultrst_aiko_user_one_main');
    expect(formatCanonicalWorkspaceFolderName('depm', 'User One', 'Main')).toBe('ultrst_depm_user_one_main');
  });
});

describe('owner-bound storage connection resolution', () => {
  const profiles = {
    aiko: {
      storage_connections: [{ id: 'aiko-drive', provider: 'google_drive' }],
    },
    srkl: {
      storage_connections: [{ id: 'srkl-b2', provider: 'backblaze_b2' }],
    },
  };

  it('requires the exact connection ID saved on the workspace', () => {
    expect(resolveWorkspaceConnection(profiles, {
      storageProvider: 'google_drive',
      storageConnectionId: 'aiko-drive',
    })).toEqual({ id: 'aiko-drive', provider: 'google_drive' });
    expect(resolveWorkspaceConnection(profiles, {
      storageProvider: 'google_drive',
      storageConnectionId: 'missing-id',
    })).toBeNull();
    expect(resolveWorkspaceConnection(profiles, {
      storageProvider: 'backblaze_b2',
      storageConnectionId: 'aiko-drive',
    })).toBeNull();
  });

  it('does not fall back to primary or first connection for legacy cloud workspaces without an ID', () => {
    expect(resolveWorkspaceConnection(profiles, {
      storageProvider: 'google_drive',
    })).toBeNull();
  });
});

describe('workspace storage path containment', () => {
  it('normalizes only safe relative paths', () => {
    expect(normalizeWorkspaceStoragePath('projects/archive/file.db')).toBe('projects/archive/file.db');
    expect(getWorkspaceFolderPrefix({ workspacePath: './ultrst_aiko_user_main' })).toBe('ultrst_aiko_user_main');
    for (const unsafe of ['../secret', 'a/../../secret', '/absolute/path', 'C:/private/file', 'a//b', 'a/./b', '']) {
      expect(() => normalizeWorkspaceStoragePath(unsafe)).toThrow(/relative path|directory segments/i);
    }
  });

  it('permits only the empty list prefix, not empty file names', () => {
    expect(normalizeWorkspaceStoragePath('', true)).toBe('');
    expect(() => normalizeWorkspaceStoragePath('')).toThrow(/relative path/i);
  });
});

describe('verified owner workspace lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMocks.queryUnifiedDb.mockResolvedValue({
      rows: [{
        id: 'owner-1',
        email: 'owner@example.test',
        username: 'owner',
        app_profiles: {
          depm: {
            workspaces: [{
              id: 'workspace-1',
              storageProvider: 'backblaze_b2',
              storageConnectionId: 'connection-1',
            }],
          },
        },
      }],
    });
    workspaceMocks.resolveUserStorageConnectionSecret.mockResolvedValue({
      id: 'connection-1',
      provider: 'backblaze_b2',
      enabled: true,
      b2BucketName: 'production-bucket',
    });
  });

  it('does not resolve workspace IDs without a verified owner identity', async () => {
    await expect(findUserWorkspace('workspace-1')).resolves.toEqual({
      user: null,
      workspace: null,
      connection: null,
    });
    expect(workspaceMocks.queryUnifiedDb).not.toHaveBeenCalled();
  });

  it('queries only the authenticated owner and returns an owner-bound connection', async () => {
    await expect(findUserWorkspace('workspace-1', undefined, 'owner-1')).resolves.toMatchObject({
      user: { id: 'owner-1' },
      workspace: { id: 'workspace-1', storageConnectionId: 'connection-1' },
      connection: {
        id: 'connection-1',
        provider: 'backblaze_b2',
        __ownerUserId: 'owner-1',
      },
    });

    expect(workspaceMocks.queryUnifiedDb).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 OR email = $1'),
      ['owner-1'],
      undefined,
    );
    expect(workspaceMocks.resolveUserStorageConnectionSecret).toHaveBeenCalledWith(
      'owner-1',
      'connection-1',
      expect.any(Function),
      'backblaze_b2',
    );
  });
});
