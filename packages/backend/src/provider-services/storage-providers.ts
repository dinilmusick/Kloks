/** Read-only storage/service discovery adapters. Account credentials stay in SRKL. */
import { createProviderClient } from './client.js';
import { resolveProviderServiceId } from './registry.js';
import type { ProviderConnection } from './types.js';
export {
  authorizeB2 as authorizeBackblazeB2,
  b2ListBuckets as listBackblazeB2Buckets,
  b2ListFileNames as listBackblazeB2Files,
  b2UploadFile as uploadBackblazeB2File,
  b2DownloadFile as downloadBackblazeB2File,
} from '../storage/B2DirectClient.js';
export {
  GoogleDriveWorkspaceService,
  GOOGLE_DRIVE_WORKSPACE_SCOPE,
} from '../storage/GoogleDriveWorkspaceService.js';

function serviceConnection(connection: ProviderConnection, provider: string): ProviderConnection {
  if (resolveProviderServiceId(connection.providerId) !== provider)
    throw new Error('Credential provider does not match the requested service');
  return connection;
}
function githubName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value === '.' || value === '..')
    throw new Error('Invalid GitHub repository owner or name');
  return value;
}
function safeRepositoryPath(path: string): string {
  const parts = path.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..'))
    throw new Error('Invalid repository path');
  return parts.map(encodeURIComponent).join('/');
}

export async function listGitHubRepositories(
  connection: ProviderConnection, transport: typeof fetch = fetch, page = 1,
): Promise<Array<{ id: number; full_name: string; private: boolean }>> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    throw new Error('Invalid GitHub repositories page');
  const { data } = await createProviderClient(serviceConnection(connection, 'github'), transport)
    .request<Array<{ id: number; full_name: string; private: boolean }>>({
      path: '/user/repos', query: {
        per_page: 100, page, affiliation: 'owner,collaborator,organization_member',
      },
    });
  if (!Array.isArray(data)) throw new Error('Invalid GitHub repositories response');
  return data;
}
export async function listGitHubRepositoryContents(
  connection: ProviderConnection, owner: string, repo: string, path = '',
  transport: typeof fetch = fetch,
): Promise<unknown> {
  const suffix = path ? '/' + safeRepositoryPath(path) : '';
  const { data } = await createProviderClient(serviceConnection(connection, 'github'), transport)
    .request({
      path: `/repos/${githubName(owner)}/${githubName(repo)}/contents${suffix}`,
    });
  return data;
}
export async function listGitLabProjects(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ id: number; path_with_namespace: string }>> {
  const { data } = await createProviderClient(serviceConnection(connection, 'gitlab'), transport)
    .request<Array<{ id: number; path_with_namespace: string }>>({
      path: '/api/v4/projects', query: { membership: true, per_page: 100 },
    });
  if (!Array.isArray(data)) throw new Error('Invalid GitLab projects response');
  return data;
}
export async function listGitLabRepositoryTree(
  connection: ProviderConnection, project: number | string, path = '',
  transport: typeof fetch = fetch,
): Promise<Array<{ id: string; name: string; type: string }>> {
  const key = String(project).trim();
  if (!key || key.includes('?') || key.includes('#')) throw new Error('GitLab project required');
  if (path) safeRepositoryPath(path);
  const { data } = await createProviderClient(serviceConnection(connection, 'gitlab'), transport)
    .request<Array<{ id: string; name: string; type: string }>>({
      path: `/api/v4/projects/${encodeURIComponent(key)}/repository/tree`,
      query: { per_page: 100, ...(path ? { path } : {}) },
    });
  if (!Array.isArray(data)) throw new Error('Invalid GitLab repository tree response');
  return data;
}
export interface DropboxFolderPage {
  entries: Array<{ '.tag': string; name: string; path_lower?: string; id?: string }>;
  cursor: string;
  has_more: boolean;
}
export async function listDropboxFolder(
  connection: ProviderConnection, path = '', transport: typeof fetch = fetch,
): Promise<DropboxFolderPage> {
  if (path && (!path.startsWith('/') || path.split('/').includes('..')))
    throw new Error('Dropbox path must be an absolute path within the account');
  const { data } = await createProviderClient(serviceConnection(connection, 'dropbox'), transport)
    .request<DropboxFolderPage>({
      path: '/2/files/list_folder', method: 'POST',
      body: { path, recursive: false, limit: 100 },
    });
  if (!Array.isArray(data?.entries) || typeof data.cursor !== 'string'
      || typeof data.has_more !== 'boolean')
    throw new Error('Invalid Dropbox folder response');
  return data;
}
export async function continueDropboxFolder(
  connection: ProviderConnection, cursor: string, transport: typeof fetch = fetch,
): Promise<DropboxFolderPage> {
  if (!cursor || typeof cursor !== 'string') throw new Error('Dropbox cursor required');
  const { data } = await createProviderClient(serviceConnection(connection, 'dropbox'), transport)
    .request<DropboxFolderPage>({
      path: '/2/files/list_folder/continue', method: 'POST', body: { cursor },
    });
  if (!Array.isArray(data?.entries) || typeof data.cursor !== 'string'
      || typeof data.has_more !== 'boolean')
    throw new Error('Invalid Dropbox cursor response');
  return data;
}
