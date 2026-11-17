import { continueDropboxFolder, listDropboxFolder } from '../storage-providers.js';
import type { ProviderConnection } from '../types.js';
import { normalizeStoragePath } from './contract.js';
import type { StorageService, StoragePage } from './contract.js';

function toDropboxPath(path: string): string {
  const normalized = normalizeStoragePath(path);
  return normalized ? '/' + normalized : '';
}
async function contentRequest(
  connection: ProviderConnection, path: string, method: 'download' | 'upload',
  transport: typeof fetch, content?: Uint8Array | string, mimeType = 'application/octet-stream',
): Promise<Response> {
  if (connection.providerId !== 'dropbox' || !connection.credential || !connection.accountId)
    throw new Error('Authorized Dropbox connection required');
  const target = toDropboxPath(path);
  if (!target) throw new Error('Dropbox file path required');
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + connection.credential,
    'Dropbox-API-Arg': JSON.stringify(method === 'download' ? { path: target } :
      { path: target, mode: 'add', autorename: false, mute: true }),
  };
  if (method === 'upload') headers['Content-Type'] = mimeType;
  const response = await transport('https://content.dropboxapi.com/2/files/' + method, {
    method: 'POST', headers, body: method === 'upload' ?
      (typeof content === 'string' ? content : new Uint8Array(content || new Uint8Array())) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Dropbox ' + method + ' HTTP ' + response.status);
  return response;
}
export function createDropboxStorageService(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): StorageService {
  if (connection.providerId !== 'dropbox') throw new Error('Dropbox connection required');
  return {
    providerId: 'dropbox',
    capabilities: Object.freeze({ list: true, read: true, write: true, delete: true }),
    async list(path = '', cursor?: string): Promise<StoragePage> {
      const value = cursor ? await continueDropboxFolder(connection, cursor, transport)
        : await listDropboxFolder(connection, toDropboxPath(path), transport);
      return {
        entries: value.entries.map(e => ({
          id: e.id || e.path_lower || e.name, name: e.name,
          path: e.path_lower || ((toDropboxPath(path) || '') + '/' + e.name),
          kind: e['.tag'] === 'folder' ? 'folder' as const : 'file' as const,
        })), nextCursor: value.has_more ? value.cursor : null,
        complete: !value.has_more,
      };
    },
    async read(path: string): Promise<Uint8Array> {
      const response = await contentRequest(connection, path, 'download', transport);
      return new Uint8Array(await response.arrayBuffer());
    },
    async write(path: string, bytes: Uint8Array | string, contentType?: string): Promise<void> {
      await contentRequest(connection, path, 'upload', transport, bytes, contentType);
    },
    async delete(path: string): Promise<void> {
      const target = toDropboxPath(path);
      if (!target) throw new Error('Refusing to delete the Dropbox root');
      const { createProviderClient } = await import('../client.js');
      await createProviderClient(connection, transport).request({
        path: '/2/files/delete_v2', method: 'POST', body: { path: target },
      });
    },
  };
}
