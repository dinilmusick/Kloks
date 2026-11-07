import { describe, expect, it } from 'vitest';
import {
  BucketStorageService,
  GoogleDriveStorageService,
  StorageAdapterFactory,
  createGoogleDriveAuthorizationUrl,
  GOOGLE_DRIVE_FILE_SCOPE,
} from './index.js';

describe('canonical storage providers', () => {
  it('exposes S3-compatible bucket storage through the canonical service', () => {
    const service = new BucketStorageService({
      provider: 's3_compatible',
      bucket: 'workspace',
      region: 'us-east-1',
      endpoint: 'https://s3.example.test',
      accessKey: 'access',
      secretKey: 'secret',
    });

    expect(service).toBeInstanceOf(BucketStorageService);
    expect(StorageAdapterFactory.create({
      provider: 's3',
      bucket: 'workspace',
      accessKey: 'access',
      secretKey: 'secret',
    })).toBeInstanceOf(BucketStorageService);
  });

  it('exposes Google Drive through the canonical service and factory', () => {
    const service = new GoogleDriveStorageService({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleRefreshToken: 'refresh-token',
    });

    expect(service).toBeInstanceOf(GoogleDriveStorageService);
    expect(StorageAdapterFactory.create({
      provider: 'google_drive',
      googleClientId: 'client-id',
      googleRefreshToken: 'refresh-token',
    })).toBeInstanceOf(GoogleDriveStorageService);
  });

  it('requests only the narrow Drive file scope by default', () => {
    const url = createGoogleDriveAuthorizationUrl(
      {
        clientId: 'client-id',
        redirectUri: 'https://example.test/oauth/google-drive',
      },
      'workspace-state',
    );

    const params = new URL(url).searchParams;
    expect(params.get('scope')).toBe(GOOGLE_DRIVE_FILE_SCOPE);
    expect(params.get('state')).toBe('workspace-state');
    expect(params.get('access_type')).toBe('offline');
  });

  it('supports PKCE for Drive authorization', () => {
    const url = createGoogleDriveAuthorizationUrl(
      {
        clientId: 'client-id',
        redirectUri: 'https://example.test/oauth/google-drive',
      },
      'workspace-state',
      'verifier-derived-challenge',
    );

    const params = new URL(url).searchParams;
    expect(params.get('code_challenge')).toBe('verifier-derived-challenge');
    expect(params.get('code_challenge_method')).toBe('S256');
  });
});
