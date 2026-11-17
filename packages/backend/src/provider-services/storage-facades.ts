/** First-class KrnlTS facades around canonical storage provider adapters. */
import { createService, createServiceDefinition, type IService } from '@ultrst-armada/krnl';
import { listGitHubRepositories, listGitHubRepositoryContents,
  listGitLabProjects, listGitLabRepositoryTree,
  listDropboxFolder, continueDropboxFolder,
  listBackblazeB2Buckets, listBackblazeB2Files,
  GoogleDriveWorkspaceService } from './storage-providers.js';
import type { GoogleDriveWorkspaceOptions } from '../storage/GoogleDriveWorkspaceService.js';
import type { ProviderConnection } from './types.js';

type ConnectionInput = { connection: ProviderConnection };
const github = createServiceDefinition({
  id: 'kloks.external.github', name: 'GitHub Provider Service', version: '1.0.0',
  operations: {
    listRepositories: { id: 'github.listRepositories', name: 'listRepositories',
      handler: ({ connection }: ConnectionInput) => listGitHubRepositories(connection) },
    listContents: { id: 'github.listContents', name: 'listContents',
      handler: (input: ConnectionInput & { owner: string; repo: string; path?: string }) =>
        listGitHubRepositoryContents(input.connection,input.owner,input.repo,input.path) },
  },
});
const gitlab = createServiceDefinition({
  id: 'kloks.external.gitlab', name: 'GitLab Provider Service', version: '1.0.0',
  operations: {
    listProjects: { id: 'gitlab.listProjects', name: 'listProjects',
      handler: ({ connection }: ConnectionInput) => listGitLabProjects(connection) },
    listTree: { id: 'gitlab.listTree', name: 'listTree',
      handler: (input: ConnectionInput & { project: string | number; path?: string }) =>
        listGitLabRepositoryTree(input.connection,input.project,input.path) },
  },
});
const dropbox = createServiceDefinition({
  id: 'kloks.external.dropbox', name: 'Dropbox Provider Service', version: '1.0.0',
  operations: {
    listFolder: { id: 'dropbox.listFolder', name: 'listFolder',
      handler: (input: ConnectionInput & { path?: string }) =>
        listDropboxFolder(input.connection,input.path) },
    continueFolder: { id: 'dropbox.continueFolder', name: 'continueFolder',
      handler: (input: ConnectionInput & { cursor: string }) =>
        continueDropboxFolder(input.connection,input.cursor) },
  },
});
const backblaze = createServiceDefinition({
  id: 'kloks.external.backblaze-b2', name: 'Backblaze B2 Provider Service', version: '1.0.0',
  operations: {
    listBuckets: { id: 'backblaze.listBuckets', name: 'listBuckets',
      handler: (input: { keyId: string; applicationKey: string }) =>
        listBackblazeB2Buckets(input.keyId,input.applicationKey) },
    listFiles: { id: 'backblaze.listFiles', name: 'listFiles',
      handler: (input: { keyId: string; applicationKey: string; bucketName: string }) =>
        listBackblazeB2Files(input.keyId,input.applicationKey,input.bucketName) },
  },
});
const drive = createServiceDefinition({
  id: 'kloks.external.google.drive', name: 'Google Drive Provider Service', version: '1.0.0',
  operations: {
    listFolders: { id: 'google.drive.listFolders', name: 'listFolders',
      handler: (input: { options: GoogleDriveWorkspaceOptions; parentFolderId?: string }) =>
        new GoogleDriveWorkspaceService(input.options).listFolders(input.parentFolderId) },
    listFiles: { id: 'google.drive.listFiles', name: 'listFiles',
      handler: (input: { options: GoogleDriveWorkspaceOptions; path?: string }) =>
        new GoogleDriveWorkspaceService(input.options).list(input.path) },
  },
});
function serviceFacade(definition: ReturnType<typeof createServiceDefinition>) {
  const instance: IService = createService(definition);
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    runtime: 'server' as const,
    deployment: 'local' as const,
    definition,
    get telemetry() { return instance.telemetry; },
    createInstance: () => createService(definition),
    execute: async <TIn = unknown, TOut = unknown>(operation: string, input: TIn): Promise<TOut> => {
      await instance.start();
      return instance.call<TIn, TOut>(operation, input);
    },
  };
}
export const GitHubProviderService = serviceFacade(github);
export const GitLabProviderService = serviceFacade(gitlab);
export const DropboxProviderService = serviceFacade(dropbox);
export const BackblazeB2ProviderService = serviceFacade(backblaze);
export const GoogleDriveProviderService = serviceFacade(drive);
