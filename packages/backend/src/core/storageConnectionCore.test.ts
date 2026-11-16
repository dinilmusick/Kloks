import { describe, expect, it } from 'vitest';
import {
  listUserStorageConnections,
  resolveUserStorageConnectionSecret,
  toPublicStorageConnection,
} from './storageConnectionCore.js';

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
    };
    let systemCredentials: Record<string, any> = {};
    const query = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM "ultrst-users"')) {
        if (params[0] !== 'user-1') return { rows: [] };
        return { rows: [{ id: 'user-1', app_profiles: profiles }] };
      }
      if (sql.includes('FROM "srkl_application_profiles"')) return { rows: [] };
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
        systemCredentials = JSON.parse(String(params[0]));
        return { rows: [] };
      }
      if (sql.includes('UPDATE "ultrst-users"')) {
        profiles = JSON.parse(String(params[0]));
        return { rows: [] };
      }
      return { rows: [] };
    };

    const publicConnections = await listUserStorageConnections('user-1', query as any);
    expect(publicConnections).toHaveLength(2);
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

});
