export { normalizeStoragePath } from '@dinilmusick/gutts/urls/safety';
/** Provider-neutral storage APIs. Credential and tenant authorization remain caller-owned. */
export type StorageProviderId = 'github' | 'backblaze-b2' | 'dropbox' | 'google-drive';
export type StorageKind = 'bucket' | 'repository' | 'folder' | 'file';
export type StorageOperation = 'list' | 'read' | 'write' | 'delete';
export interface StorageEntry {
  id: string;
  path: string;
  name: string;
  kind: StorageKind;
  size?: number;
}
export interface StoragePage {
  entries: StorageEntry[];
  nextCursor: string | null;
  /** False signals a known provider listing limit, never silently complete. */
  complete: boolean;
}
export interface StorageCapabilities {
  list: boolean;
  read: boolean;
  write: boolean;
  delete: boolean;
}
export interface CanonicalStorageService {
  readonly providerId: StorageProviderId;
  readonly capabilities: Readonly<StorageCapabilities>;
  list(path?: string, cursor?: string): Promise<StoragePage>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array | string, contentType?: string): Promise<void>;
  delete(path: string): Promise<void>;
}
export class UnsupportedStorageOperation extends Error {
  readonly code = 'STORAGE_OPERATION_UNSUPPORTED';
  constructor(readonly providerId: StorageProviderId, readonly operation: StorageOperation) {
    super(`Storage provider ${providerId} does not support ${operation} through this adapter`);
    this.name = 'UnsupportedStorageOperation';
  }
}
/** Check capability before performing an operation; no stubs or false support. */
export function assertStorageOperation(service: CanonicalStorageService, operation: StorageOperation): void {
  if (!service.capabilities[operation])
    throw new UnsupportedStorageOperation(service.providerId, operation);
}
export function readOnlyService(id: StorageProviderId): {
  read: (path: string) => Promise<Uint8Array>;
  write: (path: string, content: Uint8Array | string) => Promise<void>;
  delete: (path: string) => Promise<void>;
} {
  return {
    read: async () => { throw new UnsupportedStorageOperation(id, 'read'); },
    write: async () => { throw new UnsupportedStorageOperation(id, 'write'); },
    delete: async () => { throw new UnsupportedStorageOperation(id, 'delete'); },
  };
}
