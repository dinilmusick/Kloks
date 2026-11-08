import { GoogleDriveAdapter } from './GoogleDriveAdapter.js';
import type { GoogleDriveRuntimeAuthOptions } from './GoogleDriveOAuth.js';
import type { StorageConfig } from './types.js';

/**
 * Canonical Google Drive implementation of the KLOKS storage abstraction.
 * Runtime auth callbacks/secrets are server-only and must not be serialized
 * into consumer-visible storage connection records.
 */
export class GoogleDriveStorageService extends GoogleDriveAdapter {
  constructor(config: StorageConfig, runtimeAuth: GoogleDriveRuntimeAuthOptions = {}) {
    super({ ...config, provider: 'google_drive' }, runtimeAuth);
  }
}
