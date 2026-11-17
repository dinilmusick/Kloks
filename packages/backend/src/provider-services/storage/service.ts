import type { ProviderConnection } from '../types.js';
import type { GoogleDriveWorkspaceOptions } from '../../storage/GoogleDriveWorkspaceService.js';
import type { B2StorageCredentials } from './backblaze-b2.js';
import type { StorageProviderId, StorageService, StorageCapabilities } from './contract.js';
import { createGitHubStorageService } from './github.js';
import { createDropboxStorageService } from './dropbox.js';
import { createBackblazeB2StorageService } from './backblaze-b2.js';
import { createGoogleDriveStorageService } from './google-drive.js';

/** Provider-typed connection prevents attaching an unrelated provider credential. */
export type StorageServiceConfig =
  | { providerId: 'github'; connection: ProviderConnection; transport?: typeof fetch }
  | { providerId: 'dropbox'; connection: ProviderConnection; transport?: typeof fetch }
  | { providerId: 'backblaze-b2'; credentials: B2StorageCredentials }
  | { providerId: 'google-drive'; options: GoogleDriveWorkspaceOptions };

const CONTRACTS: Record<StorageProviderId, StorageCapabilities> = {
  github: { list: true, read: true, write: false, delete: false },
  dropbox: { list: true, read: true, write: true, delete: true },
  'backblaze-b2': { list: true, read: true, write: true, delete: false },
  'google-drive': { list: true, read: true, write: true, delete: true },
};
export function listCanonicalStorageProviders(): Array<{
  id: StorageProviderId; capabilities: Readonly<StorageCapabilities>;
}> {
  return (Object.keys(CONTRACTS) as StorageProviderId[]).map(id => ({
    id, capabilities: Object.freeze({ ...CONTRACTS[id] }),
  }));
}
export function getCanonicalStorageCapabilities(id: StorageProviderId): Readonly<StorageCapabilities> {
  if (!Object.prototype.hasOwnProperty.call(CONTRACTS, id))
    throw new Error('Unsupported canonical storage provider');
  return Object.freeze({ ...CONTRACTS[id] });
}
/** One runtime-neutral contract; no per-app provider SDK code is necessary. */
export function createCanonicalStorageService(config: StorageServiceConfig): StorageService {
  switch (config.providerId) {
    case 'github': return createGitHubStorageService(config.connection, config.transport);
    case 'dropbox': return createDropboxStorageService(config.connection, config.transport);
    case 'backblaze-b2': return createBackblazeB2StorageService(config.credentials);
    case 'google-drive': return createGoogleDriveStorageService(config.options);
    default: throw new Error('Unsupported canonical storage provider');
  }
}
