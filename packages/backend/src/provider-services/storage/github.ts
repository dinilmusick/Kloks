import { listGitHubRepositories, listGitHubRepositoryContents } from '../storage-providers.js';
import type { ProviderConnection } from '../types.js';
import { normalizeStoragePath, UnsupportedStorageOperation } from './contract.js';
import type { CanonicalStorageService, StorageEntry, StoragePage } from './contract.js';

function splitRepo(path: string): { owner: string; repo: string; file: string } {
  const parts = normalizeStoragePath(path).split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error('GitHub path must start with owner/repository');
  return { owner: parts[0], repo: parts[1], file: parts.slice(2).join('/') };
}
function toEntry(value: { name: string; path: string; type: string; sha?: string; size?: number },
  prefix: string): StorageEntry {
  return {
    id: value.sha || value.path, name: value.name,
    path: '/' + prefix + '/' + value.path,
    kind: value.type === 'dir' ? 'folder' : 'file',
    ...(typeof value.size === 'number' ? { size: value.size } : {}),
  };
}
/** GitHub contents API: read/list only; commits require separate explicit revision semantics. */
export function createGitHubStorageService(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): CanonicalStorageService {
  if (connection.providerId !== 'github') throw new Error('GitHub connection required');
  const capabilities = Object.freeze({ list: true, read: true, write: false, delete: false });
  return {
    providerId: 'github', capabilities,
    async list(path = '', cursor?: string): Promise<StoragePage> {
      const normalized = normalizeStoragePath(path);
      if (!normalized) {
        const page = cursor ? Number(cursor) : 1;
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid GitHub cursor');
        const repos = await listGitHubRepositories(connection, transport, page);
        return {
          entries: repos.map(repo => ({
            id: String(repo.id), name: repo.full_name.split('/').pop()!,
            path: '/' + repo.full_name, kind: 'repository' as const,
          })), nextCursor: repos.length === 100 ? String(page + 1) : null,
          complete: repos.length < 100,
        };
      }
      if (cursor) throw new Error('GitHub directory listings do not support cursors');
      const { owner, repo, file } = splitRepo(normalized);
      const values = await listGitHubRepositoryContents(connection, owner, repo, file, transport);
      if (!Array.isArray(values)) throw new Error('GitHub path is not a directory');
      if (values.length >= 1000) throw new Error('GitHub directory exceeds contents API limit');
      return { entries: values.map(v => toEntry(v, owner + '/' + repo)),
        nextCursor: null, complete: true };
    },
    async read(path: string): Promise<Uint8Array> {
      const { owner, repo, file } = splitRepo(path);
      if (!file) throw new Error('GitHub file path required');
      const data = await listGitHubRepositoryContents(connection, owner, repo, file, transport);
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('GitHub file metadata missing');
      const result = data as { type?: string; encoding?: string; content?: string };
      if (result.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string')
        throw new Error('GitHub contents API did not supply file bytes');
      const binary = atob(result.content.replace(/\s/g, ''));
      return Uint8Array.from(binary, c => c.charCodeAt(0));
    },
    async write(): Promise<void> { throw new UnsupportedStorageOperation('github', 'write'); },
    async delete(): Promise<void> { throw new UnsupportedStorageOperation('github', 'delete'); },
  };
}
