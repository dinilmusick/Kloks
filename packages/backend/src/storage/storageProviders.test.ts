import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => {
  throw new Error('The optional Supabase driver must not load during module initialization.');
});
import {
  BucketStorageService,
  GoogleDriveStorageService,
  SupabaseStorageAdapter,
  StorageAdapterFactory,
  createGoogleDriveAuthorizationUrl,
  GOOGLE_DRIVE_STORAGE_SCOPE,
} from './node.js';

describe('canonical storage providers', () => {
  it('keeps the optional Supabase driver lazy until storage is used', () => {
    const adapter = new SupabaseStorageAdapter({
      provider: 'supabase',
      bucket: 'workspace',
      endpoint: 'https://example.supabase.co',
      accessKey: 'test-key',
    });
    expect(adapter).toBeInstanceOf(SupabaseStorageAdapter);
  });
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

  it('requests the minimum scope required for an arbitrary read/write storage root', () => {
    const url = createGoogleDriveAuthorizationUrl(
      {
        clientId: 'client-id',
        redirectUri: 'https://example.test/oauth/google-drive',
      },
      'workspace-state',
    );

    const params = new URL(url).searchParams;
    expect(params.get('scope')).toBe(GOOGLE_DRIVE_STORAGE_SCOPE);
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
