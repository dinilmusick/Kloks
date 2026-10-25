export type StorageMode = 'local' | 'local_hosted' | 'remote';
export type StorageProviderType =
  | 'local_fs'
  | 'backblaze_b2'
  | 'b2'
  | 'supabase'
  | 'firebase'
  | 'google_drive';

export interface StorageConfig {
  provider: StorageProviderType;
  mode?: StorageMode;
  basePath?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  b2KeyId?: string;
  b2ApplicationKey?: string;
  b2BucketName?: string;
  b2Endpoint?: string;
  b2Region?: string;
  keyId?: string;
  applicationKey?: string;
  accountId?: string;
  googleClientId?: string;
  googleRedirectUri?: string;
  googleAccessToken?: string;
  googleAccessTokenExpiresAt?: number;
  googleRefreshToken?: string;
  googleRootFolderId?: string;
}

export interface FileInfo {
  path: string;
  size: number;
  modifiedAt: number;
  contentHash?: string;
}

export interface UploadResult {
  path: string;
  size: number;
  url?: string;
}

export interface DeleteFolderResult {
  success: boolean;
  deletedCount: number;
}

export interface RenameFolderResult {
  success: boolean;
  movedCount: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, any>;
}
