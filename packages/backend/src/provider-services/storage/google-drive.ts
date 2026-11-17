import { GoogleDriveWorkspaceService } from '../../storage/GoogleDriveWorkspaceService.js';
import type { GoogleDriveWorkspaceOptions } from '../../storage/GoogleDriveWorkspaceService.js';
import { normalizeStoragePath } from './contract.js';
import type { CanonicalStorageService, StoragePage } from './contract.js';

/** Delegates OAuth refresh, root-scoping and safe writes to canonical Drive implementation. */
export function createGoogleDriveStorageService(options: GoogleDriveWorkspaceOptions): CanonicalStorageService {
  const drive = new GoogleDriveWorkspaceService(options);
  return {
    providerId: 'google-drive',
    capabilities: Object.freeze({ list: true, read: true, write: true, delete: true }),
    async list(path = '', cursor?: string): Promise<StoragePage> {
      if (cursor) throw new Error('Google Drive adapter handles pagination internally');
      const files = await drive.list(normalizeStoragePath(path));
      return {
        entries: files.map(file => ({
          id: String(file.id || file.path), path: '/' + file.path,
          name: file.path.split('/').pop() || file.path,
          kind: file.isFolder ? 'folder' as const : 'file' as const,
          ...(Number.isFinite(file.size) ? { size: file.size } : {}),
        })), nextCursor: null, complete: true,
      };
    },
    read(path: string) { return drive.read(normalizeStoragePath(path)); },
    write(path: string, content: Uint8Array | string, contentType?: string) {
      return drive.write(normalizeStoragePath(path), content, contentType);
    },
    delete(path: string) { return drive.delete(normalizeStoragePath(path)); },
  };
}
