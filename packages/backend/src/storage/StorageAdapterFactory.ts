import { BaseStorageAdapter } from './BaseStorageAdapter.js';
import { StorageConfig } from './types.js';
import { LocalFSAdapter } from './LocalFSAdapter.js';
import { S3Adapter } from './S3Adapter.js';
import { BackblazeB2Adapter } from './BackblazeB2Adapter.js';
import { SupabaseStorageAdapter } from './SupabaseStorageAdapter.js';
import { GoogleDriveAdapter } from './GoogleDriveAdapter.js';

export class StorageAdapterFactory {
  static create(config: StorageConfig): BaseStorageAdapter {
    switch (config.provider) {
      case 'local_fs':
        return new LocalFSAdapter(config);
      case 'backblaze_b2':
      case 'b2':
        return new BackblazeB2Adapter(config);
      case 'supabase':
        return new SupabaseStorageAdapter(config);
      case 'google_drive':
        return new GoogleDriveAdapter(config);
      default:
        throw new Error(`Unsupported storage provider: ${config.provider}`);
    }
  }
}
