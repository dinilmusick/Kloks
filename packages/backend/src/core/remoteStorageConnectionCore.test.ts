import { describe, expect, it, vi } from 'vitest';
import {
  createRemoteStorageConnection,
  deleteUserStorageConnection,
  listRemoteStorageConnectionEntries,
  listUserStorageConnections,
  readRemoteStorageConnectionFile,
  resolveUserStorageConnectionSecret,
  rotateRemoteStorageConnectionToken,
  writeRemoteStorageConnectionFile,
} from './storageConnectionCore.js';

const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function database() {
  const profiles: Record<string, any> = {
    'owner-a': { srkl: { storage_connections: [] } },
    'owner-b': { srkl: { storage_connections: [] } },
  };
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM "ultrst-users"')) {
      const owner = String(params[0]);
      return profiles[owner] ? {
        rows: [{ id: owner, email: owner + '@example.test', app_profiles: profiles[owner] }],
      } : { rows: [] };
    }
    if (sql.includes('FROM "srkl_application_profiles"')) return { rows: [] };
    if (sql.includes('FROM public."ultrst-credentials"')) return {
      rows: [{ id: 'system', credentials: { storageConnections: { encryptionKey: key, encryptionKeyVersion: 1 } } }],
    };
    if (sql.startsWith('UPDATE "ultrst-users"')) {
      const owner = String(params[1]);
      profiles[owner] = JSON.parse(String(params[0]));
    }
    return { rows: [] };
  };
  return { profiles, query: query as any };
}

function providerApi() {
  const transport = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    const token = (init?.headers as Record<string, string> | undefined)?.Authorization || '';
    if (token.includes('revoked')) return new Response('denied', { status: 401 });
    if (url.endsWith('/user')) {
      return Response.json({ id: token.includes('other') ? 999 : 123, login: 'octo-user' });
    }
    if (url.includes('/user/repos')) return Response.json([
      { id: 50, full_name: 'octo-user/project', private: true },
    ]);
    if (url.endsWith('/2/users/get_current_account')) return Response.json({
      account_id: 'dbid:verified-account', name: { display_name: 'Dropbox account' },
    });
    if (url.endsWith('/2/files/list_folder')) {
      if (token.includes('no-metadata')) return new Response('scope denied', { status: 403 });
      return Response.json({
        entries: [{ '.tag': 'file', id: 'id:one', name: 'readme.txt', path_lower: '/readme.txt' }],
        cursor: 'cursor-one', has_more: false,
      });
    }
    if (url.endsWith('/2/files/upload')) return Response.json({ id: 'uploaded' });
    if (url.includes('/repos/octo-user/project/contents/README.md')) {
      return Response.json({ type: 'file', encoding: 'base64', content: 'SGVsbG8=' });
    }
    throw new Error('Unexpected provider API endpoint: ' + url);
  });
  return transport as unknown as typeof fetch;
}

describe('owner-bound GitHub and Dropbox connections for Frnes', () => {
  it('persists two independently named accounts per service under AEAD, never exposing tokens', async () => {
    const db = database();
    const api = providerApi();
    for (const provider of ['github', 'dropbox'] as const) {
      for (const label of ['primary ' + provider, 'secondary ' + provider]) {
        const connection = await createRemoteStorageConnection({
          userId: 'owner-a', provider, accessToken: provider + '-token-private', label,
        }, db.query, api);
        expect(connection).toMatchObject({ provider, label, testStatus: 'ok' });
        expect(JSON.stringify(connection)).not.toContain('token-private');
      }
    }
    const publicList = await listUserStorageConnections('owner-a', db.query);
    expect(publicList).toHaveLength(4);
    expect(new Set(publicList.map(item => item.id)).size).toBe(4);
    expect(JSON.stringify(publicList)).not.toContain('token-private');
    const persisted = JSON.stringify(db.profiles['owner-a']);
    expect(persisted).not.toContain('token-private');
    expect(db.profiles['owner-a'].srkl.storage_connections).toEqual(
      expect.arrayContaining([expect.objectContaining({
        secretCiphertext: expect.objectContaining({ algorithm: 'AES-GCM-256' }),
      })]),
    );
    const decrypted = await resolveUserStorageConnectionSecret('owner-a', publicList[0].id, db.query);
    expect(decrypted?.githubAccessToken).toBe('github-token-private');
    expect(await listUserStorageConnections('owner-b', db.query)).toEqual([]);
  });

  it('denies cross-owner access, and provider operation token never appears in the result', async () => {
    const db = database();
    const api = providerApi();
    const connection = await createRemoteStorageConnection({
      userId: 'owner-a', provider: 'github', accessToken: 'private-github-token',
    }, db.query, api);
    const before = (api as any).mock.calls.length;
    await expect(listRemoteStorageConnectionEntries('owner-b', connection.id, '', undefined, db.query, api))
      .rejects.toThrow(/not available/i);
    expect((api as any).mock.calls).toHaveLength(before);
    const listing = await listRemoteStorageConnectionEntries('owner-a', connection.id, '', undefined, db.query, api);
    expect(listing.entries).toMatchObject([{ path: '/octo-user/project' }]);
    expect(JSON.stringify(listing)).not.toContain('private-github-token');
    expect(await readRemoteStorageConnectionFile('owner-a', connection.id,
      'octo-user/project/README.md', db.query, api)).toEqual(new TextEncoder().encode('Hello'));
    await expect(writeRemoteStorageConnectionFile('owner-a', connection.id,
      'octo-user/project/README.md', 'override', db.query, api)).rejects.toThrow(/commit authorization/i);
    await deleteUserStorageConnection('owner-a', connection.id, db.query);
    await expect(listRemoteStorageConnectionEntries('owner-a', connection.id, '', undefined, db.query, api))
      .rejects.toThrow(/not available/i);
  });

  it('rejects revoked tokens, missing Dropbox metadata scope and malformed provider identity before saving', async () => {
    const db = database();
    const api = providerApi();
    await expect(createRemoteStorageConnection({
      userId: 'owner-a', provider: 'github', accessToken: 'revoked',
    }, db.query, api)).rejects.toThrow(/HTTP 401/);
    await expect(createRemoteStorageConnection({
      userId: 'owner-a', provider: 'dropbox', accessToken: 'no-metadata',
    }, db.query, api)).rejects.toThrow(/HTTP 403/);
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ invalid: true }));
    await expect(createRemoteStorageConnection({
      userId: 'owner-a', provider: 'github', accessToken: 'unused',
    }, db.query, malformed)).rejects.toThrow(/identity response/i);
    expect(await listUserStorageConnections('owner-a', db.query)).toHaveLength(0);
  });

  it('rotates only for a proven same-account token and preserves old credential on rejection', async () => {
    const db = database();
    const api = providerApi();
    const connection = await createRemoteStorageConnection({
      userId: 'owner-a', provider: 'github', accessToken: 'first-token',
    }, db.query, api);
    await expect(rotateRemoteStorageConnectionToken({
      userId: 'owner-a', connectionId: connection.id, accessToken: 'other-user-token',
    }, db.query, api)).rejects.toThrow(/different provider account/i);
    expect((await resolveUserStorageConnectionSecret('owner-a', connection.id, db.query))?.githubAccessToken)
      .toBe('first-token');
    await rotateRemoteStorageConnectionToken({
      userId: 'owner-a', connectionId: connection.id, accessToken: 'replacement-token',
    }, db.query, api);
    expect((await resolveUserStorageConnectionSecret('owner-a', connection.id, db.query))?.githubAccessToken)
      .toBe('replacement-token');
  });

  it('writes only through a saved Dropbox connection with provider-side authorization', async () => {
    const db = database();
    const api = providerApi();
    const connection = await createRemoteStorageConnection({
      userId: 'owner-a', provider: 'dropbox', accessToken: 'valid-dropbox',
    }, db.query, api);
    await writeRemoteStorageConnectionFile('owner-a', connection.id, 'folder/file.txt',
      new TextEncoder().encode('hello'), db.query, api);
    expect((api as any).mock.calls.some(([url]: [string]) => String(url).endsWith('/2/files/upload')))
      .toBe(true);
    await expect(writeRemoteStorageConnectionFile('owner-b', connection.id, 'file.txt',
      'should fail', db.query, api)).rejects.toThrow(/not available/i);
  });
});
