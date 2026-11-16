import { describe, expect, it } from 'vitest';
import { formatCanonicalWorkspaceFolderName } from '../workspace/WorkspaceCanonical.js';
import { resolveWorkspaceConnection } from './workspaceBucketSyncCore.js';
import { getWorkspaceFolderPrefix, normalizeWorkspaceStoragePath } from './workspaceFileCore.js';

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
