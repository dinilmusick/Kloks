import { GoogleDriveAdapter } from './GoogleDriveAdapter.js';
import type { StorageConfig } from './types.js';

export class GoogleDriveStorageService extends GoogleDriveAdapter {
  constructor(config: StorageConfig) {
    super({ ...config, provider: 'google_drive' });
  }
}
