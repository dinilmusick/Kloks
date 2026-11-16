import { describe, expect, it } from 'vitest';
import {
  listUserStorageConnections,
  resolveUserStorageConnectionSecret,
  toPublicStorageConnection,
} from './storageConnectionCore.js';
import { getOrCreateStorageConnectionEncryptionKey, getStorageConnectionEncryptionKey } from './systemCredentialsCore.js';

describe('canonical user storage connection security contract', () => {
  it('projects only safe connection metadata to browser callers', () => {
    const raw = {
      id: 'conn-b2-1',
      provider: 'backblaze_b2',
      label: 'Production B2',
      role: 'primary',
      enabled: true,
      b2BucketName: 'archive',
      b2Region: 'us-west-004',
      b2KeyId: 'account-key-id',
      b2ApplicationKey: 'super-secret-b2-key',
      googleAccessToken: 'google-access-token',
      googleRefreshToken: 'google-refresh-token',
      clientSecret: 'system-google-client-secret',
      metadata: { token: 'leaked-token' },
    };
    const projected = toPublicStorageConnection(raw);
    expect(projected).toMatchObject({
      id: 'conn-b2-1',
      provider: 'backblaze_b2',
      label: 'Production B2',
      role: 'primary',
      b2BucketName: 'archive',
    });
    const serialized = JSON.stringify(projected);
    for (const secret of [
      'account-key-id',
      'super-secret-b2-key',
      'google-access-token',
      'google-refresh-token',
      'system-google-client-secret',
      'leaked-token',
      'b2ApplicationKey',
      'googleAccessToken',
      'googleRefreshToken',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('reads the user-owned SRKL compatibility profile while listing only safe projections', async () => {
    const calls: string[] = [];
    const query = async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM public."ultrst-credentials"')) {
        return {
          rows: [{
            id: 'system',
            credentials: {
              storageConnections: {
                encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                encryptionKeyVersion: 1,
              },
            },
          }],
        };
      }
      if (sql.includes('"ultrst-users"')) {
        return {
          rows: [{
            id: 'user-1',
            app_profiles: {
              aiko: {
                storage_connections: [{
                  id: 'drive-1',
                  provider: 'google_drive',
                  label: 'Owner Drive',
                  googleEmail: 'owner@example.test',
                  googleAccessToken: 'secret-access',
                  googleRefreshToken: 'secret-refresh',
                }],
              },
            },
          }],
        };
      }
      return { rows: [] };
    };
    const connections = await listUserStorageConnections('user-1', query as any);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      id: 'drive-1',
      provider: 'google_drive',
      googleEmail: 'owner@example.test',
    });
    expect(JSON.stringify(connections)).not.toContain('secret-access');
    expect(JSON.stringify(connections)).not.toContain('secret-refresh');
    expect(calls.some((sql) => sql.includes('"srkl_application_profiles"'))).toBe(true);
  });

  it('keeps the server-only secret resolver scoped to the supplied user profile', async () => {
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public."ultrst-credentials"')) {
        return {
          rows: [{
            id: 'system',
            credentials: {
              storageConnections: {
                encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                encryptionKeyVersion: 1,
              },
            },
          }],
        };
      }
      if (sql.includes('"ultrst-users"')) {
        if (params?.[0] === 'other-user') return { rows: [] };
        expect(params?.[0]).toBe('user-1');
        return {
          rows: [{
            id: 'user-1',
            app_profiles: {
              srkl: {
                storage_connections: [{
                  id: 'b2-1',
                  provider: 'backblaze_b2',
                  b2KeyId: 'key-id',
                  b2ApplicationKey: 'private-b2-key',
                }],
              },
            },
          }],
        };
      }
      return { rows: [] };
    };
    const connection = await resolveUserStorageConnectionSecret('user-1', 'b2-1', query as any);
    expect(connection?.b2ApplicationKey).toBe('private-b2-key');
    expect(await resolveUserStorageConnectionSecret('other-user', 'b2-1', query as any)).toBeNull();
  });
  it('migrates legacy B2 and Google credentials to user-bound AES-GCM ciphertext', async () => {
    let profiles: Record<string, any> = {
      aiko: {
        storage_connections: [
          {
            id: 'b2-legacy',
            provider: 'backblaze_b2',
            label: 'Legacy B2',
            role: 'primary',
            b2KeyId: 'legacy-key-id',
            b2ApplicationKey: 'legacy-b2-secret',
            b2BucketName: 'archive',
          },
          {
            id: 'drive-legacy',
            provider: 'google_drive',
            label: 'Legacy Google',
            googleEmail: 'owner@example.test',
            googleAccountId: 'google-subject',
            googleAccessToken: 'legacy-google-access',
            googleRefreshToken: 'legacy-google-refresh',
            googleAccessTokenExpiresAt: 123456,
          },
        ],
      },
      kone: {
        workspaces: [{ id: 'kone-workspace', storageProvider: 'backblaze_b2', storageConnectionId: 'kone-b2' }],
        unrelatedProfileSetting: { retained: true },
      },
      srkl: {
        workspaces: [{ id: 'srkl-workspace', storageProvider: 'backblaze_b2', storageConnectionId: 'srkl-legacy-b2' }],
        activeWorkspaceId: 'srkl-workspace',
      },
    };
    let legacyProfiles: Record<string, any> = {
      srkl: {
        workspaces: [{ id: 'legacy-vault', storageProvider: 'backblaze_b2', storageConnectionId: 'srkl-legacy-b2' }],
        activeWorkspaceId: 'legacy-vault',
        storage_connections: [{
          id: 'srkl-legacy-b2',
          provider: 'backblaze_b2',
          label: 'Legacy SRKL B2',
          b2KeyId: 'legacy-srkl-key-id',
          b2ApplicationKey: 'legacy-srkl-secret',
          b2BucketName: 'srkl-vault',
        }],
      },
      legacyApp: { preferences: { preserve: true } },
    };
    let systemCredentials: Record<string, any> = {};
    const query = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM "ultrst-users"')) {
        if (params[0] !== 'user-1') return { rows: [] };
        return { rows: [{ id: 'user-1', app_profiles: profiles }] };
      }
      if (sql.includes('FROM "srkl_application_profiles"')) {
        return { rows: [{ app_profiles: legacyProfiles }] };
      }
      if (sql.includes('FROM public."ultrst-credentials"')) {
        return {
          rows: [{
            id: 'system',
            credentials: systemCredentials,
            created_at: new Date(0),
            updated_at: new Date(0),
          }],
        };
      }
      if (sql.includes('INSERT INTO public."ultrst-credentials"')) {
        if (!systemCredentials || Object.keys(systemCredentials).length === 0) {
          systemCredentials = {};
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE public."ultrst-credentials"')) {
        const key = String(params[0]);
        if (!systemCredentials.storageConnections?.encryptionKey) {
          systemCredentials = {
            ...systemCredentials,
            storageConnections: {
              ...(systemCredentials.storageConnections || {}),
              encryptionKey: key,
              encryptionKeyVersion: 1,
            },
          };
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE "srkl_application_profiles"')) {
        legacyProfiles = JSON.parse(String(params[0]));
        return { rows: [] };
      }
      if (sql.includes('UPDATE "ultrst-users"')) {
        profiles = JSON.parse(String(params[0]));
        return { rows: [] };
      }
      return { rows: [] };
    };

    const publicConnections = await listUserStorageConnections('user-1', query as any);
    expect(publicConnections).toHaveLength(3);
    expect(JSON.stringify(publicConnections)).not.toContain('legacy-key-id');
    expect(JSON.stringify(publicConnections)).not.toContain('legacy-b2-secret');
    expect(JSON.stringify(publicConnections)).not.toContain('legacy-google-access');
    expect(JSON.stringify(publicConnections)).not.toContain('legacy-google-refresh');
    expect(typeof systemCredentials.storageConnections.encryptionKey).toBe('string');
    expect(systemCredentials.storageConnections.encryptionKey.length).toBeGreaterThanOrEqual(43);

    const persisted = profiles.aiko.storage_connections;
    expect(persisted[0]).toHaveProperty('secretCiphertext.algorithm', 'AES-GCM-256');
    expect(persisted[1]).toHaveProperty('secretCiphertext.algorithm', 'AES-GCM-256');
    for (const secret of [
      'legacy-key-id',
      'legacy-b2-secret',
      'legacy-google-access',
      'legacy-google-refresh',
    ]) {
      expect(JSON.stringify(persisted)).not.toContain(secret);
    }
    expect(persisted[0]).not.toHaveProperty('b2KeyId');
    expect(persisted[0]).not.toHaveProperty('b2ApplicationKey');
    expect(persisted[1]).not.toHaveProperty('googleAccessToken');
    expect(persisted[1]).not.toHaveProperty('googleRefreshToken');
    expect(profiles.kone.workspaces[0]).toMatchObject({
      id: 'kone-workspace',
      storageConnectionId: 'kone-b2',
    });
    expect(profiles.kone.unrelatedProfileSetting).toEqual({ retained: true });
    expect(profiles.srkl.workspaces[0]).toMatchObject({
      id: 'srkl-workspace',
      storageConnectionId: 'srkl-legacy-b2',
    });
    expect(legacyProfiles.srkl.workspaces[0]).toMatchObject({
      id: 'legacy-vault',
      storageConnectionId: 'srkl-legacy-b2',
    });
    expect(legacyProfiles.legacyApp.preferences).toEqual({ preserve: true });
    expect(legacyProfiles.srkl.storage_connections[0]).toHaveProperty('secretCiphertext.algorithm', 'AES-GCM-256');
    expect(JSON.stringify(legacyProfiles)).not.toContain('legacy-srkl-key-id');
    expect(JSON.stringify(legacyProfiles)).not.toContain('legacy-srkl-secret');

    const legacyB2 = await resolveUserStorageConnectionSecret('user-1', 'srkl-legacy-b2', query as any);
    expect(legacyB2).toMatchObject({
      b2KeyId: 'legacy-srkl-key-id',
      b2ApplicationKey: 'legacy-srkl-secret',
      b2BucketName: 'srkl-vault',
    });

    const b2 = await resolveUserStorageConnectionSecret('user-1', 'b2-legacy', query as any);
    expect(b2).toMatchObject({
      b2KeyId: 'legacy-key-id',
      b2ApplicationKey: 'legacy-b2-secret',
      b2BucketName: 'archive',
    });
    const drive = await resolveUserStorageConnectionSecret('user-1', 'drive-legacy', query as any);
    expect(drive).toMatchObject({
      googleAccessToken: 'legacy-google-access',
      googleRefreshToken: 'legacy-google-refresh',
      googleEmail: 'owner@example.test',
    });
    expect(await resolveUserStorageConnectionSecret('different-user', 'b2-legacy', query as any)).toBeNull();
  });



  it('does not mint a replacement system key when decrypting an existing envelope', async () => {
    let keyWrites = 0;
    const profiles = {
      srkl: {
        storage_connections: [{
          id: 'encrypted-b2',
          provider: 'backblaze_b2',
          label: 'Encrypted B2',
          secretCiphertext: {
            version: 1,
            algorithm: 'AES-GCM-256',
            iv: 'AAAAAAAAAAAAAAAA',
            ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
          },
        }],
      },
    };
    const query = async (sql: string) => {
      if (sql.includes('FROM "ultrst-users"')) {
        return { rows: [{ id: 'user-1', app_profiles: profiles }] };
      }
      if (sql.includes('FROM "srkl_application_profiles"')) return { rows: [] };
      if (sql.includes('FROM public."ultrst-credentials"')) {
        return { rows: [{ id: 'system', credentials: {} }] };
      }
      if (sql.includes('UPDATE public."ultrst-credentials"')) keyWrites += 1;
      return { rows: [] };
    };

    await expect(resolveUserStorageConnectionSecret('user-1', 'encrypted-b2', query as any))
      .rejects.toThrow(/storage encryption key is missing/i);
    expect(keyWrites).toBe(0);
  });


  it('rejects unsupported system key versions without replacing the installed key', async () => {
    const installedKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    let updates = 0;
    const query = async (sql: string) => {
      if (sql.includes('SELECT id, credentials')) {
        return { rows: [{
          id: 'system',
          credentials: { storageConnections: { encryptionKey: installedKey, encryptionKeyVersion: 2 } },
        }] };
      }
      if (sql.includes('UPDATE public."ultrst-credentials"')) updates += 1;
      return { rows: [] };
    };

    await expect(getStorageConnectionEncryptionKey(query as any))
      .rejects.toThrow(/version is not supported/i);
    expect(updates).toBe(0);
  });

  it('installs one raw 32-byte AES-256 key with an atomic nested merge', async () => {
    let systemCredentials: Record<string, any> = {
      googleDriveOAuth: {
        clientId: 'system-client-id',
        clientSecret: 'system-client-secret',
      },
      unrelatedSystemSetting: { retained: true },
    };
    let updateCount = 0;
    const query = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT id, credentials')) {
        return { rows: [{ id: 'system', credentials: systemCredentials }] };
      }
      if (sql.includes('UPDATE public."ultrst-credentials"')) {
        updateCount += 1;
        // Model PostgreSQL's conditional row update: exactly one concurrent
        // initializer wins; a later writer cannot replace the persisted key.
        if (!systemCredentials.storageConnections?.encryptionKey) {
          systemCredentials = {
            ...systemCredentials,
            storageConnections: {
              ...(systemCredentials.storageConnections || {}),
              encryptionKey: String(params[0]),
              encryptionKeyVersion: 1,
            },
          };
        }
        return { rows: [] };
      }
      return { rows: [] };
    };

    const [first, second] = await Promise.all([
      getOrCreateStorageConnectionEncryptionKey(query as any),
      getOrCreateStorageConnectionEncryptionKey(query as any),
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const base64 = first.replace(/-/g, '+').replace(/_/g, '/').padEnd(44, '=');
    expect(atob(base64)).toHaveLength(32);
    expect(systemCredentials.googleDriveOAuth.clientId).toBe('system-client-id');
    expect(systemCredentials.googleDriveOAuth.clientSecret).toBe('system-client-secret');
    expect(systemCredentials.unrelatedSystemSetting).toEqual({ retained: true });
    expect(systemCredentials.storageConnections.encryptionKeyVersion).toBe(1);
    expect(updateCount).toBe(2);
  });

  it('refuses to replace a malformed existing wrapping key', async () => {
    let updateCount = 0;
    const query = async (sql: string) => {
      if (sql.includes('SELECT id, credentials')) {
        return { rows: [{ id: 'system', credentials: { storageConnections: { encryptionKey: 'not-a-valid-key' } } }] };
      }
      if (sql.includes('UPDATE public."ultrst-credentials"')) updateCount += 1;
      return { rows: [] };
    };
    await expect(getOrCreateStorageConnectionEncryptionKey(query as any)).rejects.toThrow(/malformed/i);
    expect(updateCount).toBe(0);
  });

});
