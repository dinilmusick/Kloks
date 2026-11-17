import { describe, expect, it, vi } from 'vitest';
import { getProviderService, getProviderServicePath, listProviderServiceTree,
  listProviderServiceChildren, listRecognizedAccountServices, listProviderServices } from './registry.js';
import { listDropboxFolder, continueDropboxFolder, listGitHubRepositories,
  listGitHubRepositoryContents, listGitLabProjects, listGitLabRepositoryTree,
  listBackblazeB2Buckets, GoogleDriveWorkspaceService } from './index.js';
const mock = (value: unknown) => vi.fn<typeof fetch>().mockImplementation(async () =>
  new Response(JSON.stringify(value), { status: 200 }),
);
const account = (providerId: string) => ({
  providerId, accountId: 'account-one', credential: 'vault-token',
});
describe('canonical storage and Google provider families', () => {
  it('keeps all Google services under a single Google suite', () => {
    const tree = listProviderServiceTree();
    const google = tree.find(entry => entry.id === 'google');
    expect(google?.category).toBe('suite');
    expect(google?.children.map(c => c.id)).toEqual(expect.arrayContaining([
      'google-gemini', 'google-drive', 'google-cloud-run',
      'google-cloud-storage', 'google-cloud-shell', 'google-vertex-ai',
    ]));
    expect(tree.some(s => s.id === 'google-drive')).toBe(false);
    expect(getProviderServicePath('google-drive').map(s => s.id)).toEqual(['google','google-drive']);
    expect(listProviderServiceChildren('google')).toHaveLength(6);
  });
  it('declares implemented storage types but does not promote unimplemented cloud storage', () => {
    const ids = listRecognizedAccountServices().map(s => s.id);
    for (const id of ['backblaze-b2','github','gitlab','dropbox','google-drive'])
      expect(ids).toContain(id);
    expect(ids).not.toContain('google-cloud-storage');
    expect(listProviderServices('storage').map(s => s.id)).toContain('google-drive');
    expect(getProviderService('google_drive')?.id).toBe('google-drive');
    expect(getProviderService('backblaze_b2')?.id).toBe('backblaze-b2');
    expect(typeof GoogleDriveWorkspaceService).toBe('function');
    expect(typeof listBackblazeB2Buckets).toBe('function');
  });
  it('supports GitHub repository discovery with scoped authentication', async () => {
    const transport = mock([{ id: 1, full_name: 'team/app', private: true }]);
    const result = await listGitHubRepositories(account('github'), transport);
    expect(result[0].full_name).toBe('team/app');
    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toContain('api.github.com/user/repos');
    expect((init?.headers as Record<string,string>).Authorization).toBe('Bearer vault-token');
    expect((init?.headers as Record<string,string>)['X-GitHub-Api-Version']).toBe('2022-11-28');
    await expect(listGitHubRepositoryContents(account('github'),'owner','repo','../secret',transport))
      .rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('calls GitLab API and validates repository paths without reflecting credentials', async () => {
    const transport = mock([{ id: 1, path_with_namespace: 'group/repo' }]);
    expect((await listGitLabProjects(account('gitlab'), transport))[0].id).toBe(1);
    expect((await listGitLabRepositoryTree(account('gitlab'), 'group/repo','src',transport))).toBeDefined();
    expect(String(transport.mock.calls[1][0])).toContain('/api/v4/projects/group%2Frepo/repository/tree');
    expect(String(transport.mock.calls[1][0])).not.toContain('vault-token');
    await expect(listGitLabRepositoryTree(account('gitlab'),'group/repo','../../..',transport))
      .rejects.toThrow();
  });
  it('supports Dropbox folder listing and cursor continuation', async () => {
    const transport = mock({ entries: [{ '.tag': 'folder', name: 'demo' }],
      cursor: 'next', has_more: true });
    const initial = await listDropboxFolder(account('dropbox'), '', transport);
    const next = await continueDropboxFolder(account('dropbox'), initial.cursor, transport);
    expect(next.entries).toHaveLength(1);
    const [url, options] = transport.mock.calls[0];
    expect(String(url)).toBe('https://api.dropboxapi.com/2/files/list_folder');
    expect(JSON.parse(options?.body as string).path).toBe('');
    expect(String(transport.mock.calls[1][0])).toContain('/list_folder/continue');
    await expect(listDropboxFolder(account('dropbox'), '../escape', transport)).rejects.toThrow();
  });
  it('denies a mismatched account provider before any request', async () => {
    const transport = mock([]);
    await expect(listGitHubRepositories(account('gitlab'), transport)).rejects.toThrow();
    await expect(listDropboxFolder(account('github'), '', transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
