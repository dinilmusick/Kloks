import { describe, expect, it, vi } from 'vitest';
import { createCanonicalStorageService, getCanonicalStorageCapabilities,
  listCanonicalStorageProviders } from './service.js';
import { normalizeStoragePath, UnsupportedStorageOperation, assertStorageOperation } from './contract.js';
import { getProviderService, listProviderServiceTree } from '../registry.js';

describe('canonical storage API contract', () => {
  const connection = (providerId: string) => ({ providerId, accountId: 'acct', credential: 'secret' });
  it('exposes a stable capability contract and no fabricated provider functions', async () => {
    const providers = listCanonicalStorageProviders();
    expect(providers.map(p => p.id)).toEqual([
      'github','dropbox','backblaze-b2','google-drive',
    ]);
    expect(getCanonicalStorageCapabilities('github').write).toBe(false);
    expect(getCanonicalStorageCapabilities('backblaze-b2').delete).toBe(false);
    expect(getCanonicalStorageCapabilities('google-drive').delete).toBe(true);
    const gh = createCanonicalStorageService({ providerId: 'github',
      connection: connection('github') });
    expect(() => assertStorageOperation(gh, 'write')).toThrow(UnsupportedStorageOperation);
    await expect(gh.write('/team/project/file', 'data')).rejects.toMatchObject({
      code: 'STORAGE_OPERATION_UNSUPPORTED', providerId: 'github', operation: 'write',
    });
    expect(() => createCanonicalStorageService({ providerId:'backblaze-b2',
      credentials: { keyId: '', applicationKey: '' } })).toThrow();
  });
  it('validates path boundaries and does not create phantom Google child services', () => {
    for (const path of ['/a/../b', '/a/./b', '/a\\b', '/a?b', '/a#b',
      '/a/%2525252e%2525252e/b', '/a/%252f/b', '/a/%2f/b'])
      expect(() => normalizeStoragePath(path)).toThrow();
    expect(normalizeStoragePath('/team/folder/')).toBe('team/folder');
    for (const unsafe of ['/a/%2e%2e/b','/a/%252e%252e/b','/a/%2f/b'])
      expect(() => normalizeStoragePath(unsafe)).toThrow();

    const google = listProviderServiceTree().find(p => p.id === 'google');
    expect(google?.children.map(p => p.id)).toEqual(expect.arrayContaining([
      'google-drive','google-gemini','google-cloud-run','google-cloud-storage',
      'google-cloud-shell','google-vertex-ai',
    ]));
    expect(getProviderService('google-cloud-run')?.apiImplemented).toBe(false);
  });
  it('normalizes GitHub repositories, directory entries, and binary reads', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = String(input);
      if (url.includes('/user/repos')) return new Response(JSON.stringify([
        { id: 1, full_name: 'team/project', private: true },
      ]));
      if (url.includes('/contents/src/file.txt')) return new Response(JSON.stringify({
        type: 'file', encoding: 'base64', content: 'aGVsbG8=', name: 'file.txt',
      }));
      return new Response(JSON.stringify([
        { type: 'file', name: 'file.txt', path: 'src/file.txt', sha: 'abc', size: 5 },
      ]));
    });
    const s = createCanonicalStorageService({
      providerId: 'github', connection: connection('github'), transport,
    });
    const root = await s.list();
    expect(root.entries[0].path).toBe('/team/project');
    expect((await s.list('/team/project/src')).entries[0].path)
      .toBe('/team/project/src/file.txt');
    expect(new TextDecoder().decode(await s.read('/team/project/src/file.txt'))).toBe('hello');
    await expect(s.read('/team')).rejects.toThrow();
    expect(transport.mock.calls.every(c => !String(c[0]).includes('secret'))).toBe(true);
  });
  it('normalizes Dropbox pagination, byte reads, create-only uploads, and deletion', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/download')) return new Response(new TextEncoder().encode('ok'));
      if (url.endsWith('/upload')) return new Response('{}');
      if (url.endsWith('/delete_v2')) return new Response(JSON.stringify({ metadata: {} }));
      return new Response(JSON.stringify({ entries: [
        { '.tag': 'file', name: 'note.txt', id: 'fid', path_lower: '/note.txt' },
      ], cursor: 'cursor-1', has_more: url.endsWith('/list_folder') }));
    });
    const service = createCanonicalStorageService({
      providerId: 'dropbox', connection: connection('dropbox'), transport,
    });
    const first = await service.list();
    expect(first.nextCursor).toBe('cursor-1');
    expect(first.complete).toBe(false);
    const second = await service.list('', first.nextCursor!);
    expect(second.complete).toBe(true);
    expect(new TextDecoder().decode(await service.read('/note.txt'))).toBe('ok');
    await service.write('/new.txt', 'hello');
    await service.delete('/new.txt');
    const upload = transport.mock.calls.find(c => String(c[0]).endsWith('/upload'))!;
    const uploadHeaders = upload[1]?.headers as Record<string, string>;
    expect(JSON.parse(uploadHeaders['Dropbox-API-Arg']).mode).toBe('add');
    expect(uploadHeaders.Authorization).toBe('Bearer secret');
    expect(transport.mock.calls.every(c => !String(c[0]).includes('secret'))).toBe(true);
    await expect(service.delete('/')).rejects.toThrow();
  });
});
