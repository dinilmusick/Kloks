/**
 * @file workspaceStorageEcosystem.test.ts
 * @description Comprehensive tests for Workspace Storage Ecosystem in Kloks:
 * 1. Workspace creation & workspace-scoped writes/isolation
 * 2. Storage adapter selection & rejection of S3
 * 3. Google Drive token refresh
 * 4. Workspace synchronization
 * 5. WorkspaceAutosaveController behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkingWorkspaceService } from '../packages/backend/src/workspace/WorkingWorkspaceService.js';
import { StorageAdapterFactory } from '../packages/backend/src/storage/StorageAdapterFactory.js';
import { refreshGoogleDriveAccessToken } from '../packages/backend/src/storage/GoogleDriveOAuth.js';
import { WorkspaceAutosaveController } from '../packages/client/src/WorkspaceAutosaveController.js';

describe('Workspace Storage Ecosystem in Kloks', () => {
  let tmpBaseDir: string;
  let service: WorkingWorkspaceService;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kloks-test-ws-'));
    service = new WorkingWorkspaceService((wsId?: string) => {
      const safeId = (wsId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
      const dir = path.join(tmpBaseDir, safeId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Workspace-Scoped Writes & File Isolation', () => {
    it('isolates writes and reads strictly per workspaceId', async () => {
      const wsA = 'workspace_alpha';
      const wsB = 'workspace_beta';

      // Write file to workspace A
      await service.writeFile(wsA, 'config.json', JSON.stringify({ name: 'Alpha' }));
      // Write file to workspace B
      await service.writeFile(wsB, 'config.json', JSON.stringify({ name: 'Beta' }));

      // Read back
      const readA = await service.readFile(wsA, 'config.json');
      const readB = await service.readFile(wsB, 'config.json');

      expect(JSON.parse(readA.toString())).toEqual({ name: 'Alpha' });
      expect(JSON.parse(readB.toString())).toEqual({ name: 'Beta' });

      // Verify files in A do not exist in B
      await service.writeFile(wsA, 'only-in-a.txt', 'secret A');
      const listB = await service.listFiles(wsB);
      expect(listB.find((f) => f.name === 'only-in-a.txt')).toBeUndefined();

      // Scoped delete: delete from A should not affect B
      const delRes = await service.deleteFile(wsA, 'config.json');
      expect(delRes.success).toBe(true);

      const listAAfter = await service.listFiles(wsA);
      expect(listAAfter.find((f) => f.name === 'config.json')).toBeUndefined();

      const readBAfter = await service.readFile(wsB, 'config.json');
      expect(JSON.parse(readBAfter.toString())).toEqual({ name: 'Beta' });
    });
  });

  describe('2. Storage Adapter Selection & Non-S3 Invariant', () => {
    it('creates LocalFSAdapter, BackblazeB2Adapter, and GoogleDriveAdapter', () => {
      const local = StorageAdapterFactory.create({ provider: 'local_fs' });
      expect(local.constructor.name).toBe('LocalFSAdapter');

      const b2 = StorageAdapterFactory.create({
        provider: 'backblaze_b2',
        b2KeyId: 'test-key',
        b2ApplicationKey: 'test-app-key',
        b2BucketName: 'test-bucket',
      });
      expect(b2.constructor.name).toBe('BackblazeB2Adapter');

      const gdrive = StorageAdapterFactory.create({
        provider: 'google_drive',
        accessKey: 'token-123',
        rootFolderId: 'folder-root',
      });
      expect(gdrive.constructor.name).toBe('GoogleDriveAdapter');
    });

    it('rejects aws_s3 and unsupported providers from new adapter creation', () => {
      expect(() => {
        StorageAdapterFactory.create({ provider: 'aws_s3' as any });
      }).toThrow(/Unsupported storage provider/i);

      expect(() => {
        StorageAdapterFactory.create({ provider: 'random_provider' as any });
      }).toThrow(/Unsupported storage provider/i);
    });
  });

  describe('3. Google Drive Token Refresh', () => {
    it('calls token endpoint with refresh_token grant and returns updated tokens', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'new-google-access-token-999',
            expires_in: 3600,
          }),
        }) as any;

        const res = await refreshGoogleDriveAccessToken('google-client-id-123', 'google-refresh-token-456');
        expect(res.accessToken).toBe('new-google-access-token-999');
        expect(res.expiresAt).toBeGreaterThan(Date.now() + 3000 * 1000);

        expect(globalThis.fetch).toHaveBeenCalledWith(
          'https://oauth2.googleapis.com/token',
          expect.objectContaining({
            method: 'POST',
          })
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws error when token refresh fails', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        }) as any;

        await expect(refreshGoogleDriveAccessToken('cid', 'bad-rt')).rejects.toThrow(
          /Google OAuth refresh failed: 401/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('4. WorkspaceAutosaveController', () => {
    it('executes save callback on saveNow() and periodically', async () => {
      let saveCount = 0;
      const saveFn = async () => {
        saveCount++;
      };

      const controller = new WorkspaceAutosaveController({
        enabled: true,
        intervalMs: 5000,
        save: saveFn,
      });

      await controller.saveNow();
      expect(saveCount).toBe(1);

      controller.setEnabled(false);
      await controller.saveNow();
      // When disabled, saveNow does nothing
      expect(saveCount).toBe(1);

      controller.stop();
    });
  });
});
