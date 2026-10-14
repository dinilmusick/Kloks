/**
 * @file workspaceStorageDetailsCore.ts
 * @description Inspection of workspace cloud storage directly via Backblaze B2.
 * Runs identically in Node.js, Vercel Serverless, and Cloudflare Workers (< 200 lines).
 */

import { findUserWorkspace } from './workspaceCore';
import { b2ListBuckets, b2ListFileNames } from './b2DirectCore';

export async function getWorkspaceStorageDetails(workspaceId: string, env?: Record<string, unknown>) {
  if (!workspaceId) return { success: false, error: 'workspaceId is required' };
  const { workspace, connection } = await findUserWorkspace(workspaceId, env);

  const folderPrefix = workspace?.localFolderKey || workspace?.localFolderName || (workspace?.workspacePath ? workspace.workspacePath.replace(/^\.\//, '') : workspaceId);

  if (!connection || (connection.provider !== 'backblaze_b2' && connection.provider !== 'BACKBLAZE_B2')) {
    return {
      success: true,
      workspaceId,
      storageProvider: workspace?.storageProvider || 'local_fs',
      connection: connection || null,
      folderPrefix,
      localStats: { exists: false, appsCount: 0, ecosystemsCount: 0 },
      bucket: null,
      files: [],
    };
  }

  const keyId = connection.b2KeyId || connection.keyId;
  const applicationKey = connection.b2ApplicationKey || connection.appKey;
  const bucketName = connection.b2BucketName || workspace.b2BucketName || 'ultrst-apps';

  try {
    const buckets = await b2ListBuckets(keyId, applicationKey, undefined, bucketName);
    const bucketObj = buckets.find((b: any) => b.bucketName === bucketName);

    if (!bucketObj) {
      return {
        success: true,
        workspaceId,
        storageProvider: 'backblaze_b2',
        connection: { id: connection.id, label: connection.label, provider: connection.provider },
        folderPrefix,
        bucket: { name: bucketName, status: 'BUCKET_NOT_FOUND' },
        files: [],
      };
    }

    const rawFiles = await b2ListFileNames(keyId, applicationKey, bucketName, `${folderPrefix}/`);

    return {
      success: true,
      workspaceId,
      storageProvider: 'backblaze_b2',
      connection: { id: connection.id, label: connection.label, provider: connection.provider },
      folderPrefix,
      bucket: {
        id: bucketObj.bucketId,
        name: bucketObj.bucketName,
        type: bucketObj.bucketType,
        endpoint: connection.b2Endpoint || 's3.eu-central-003.backblazeb2.com',
        region: connection.b2Region || 'eu-central-003',
        status: 'CONNECTED',
      },
      fileCount: rawFiles.length,
      files: rawFiles.map((f: any) => ({
        fileName: f.fileName,
        sizeBytes: f.contentLength,
        uploadTimestamp: f.uploadTimestamp,
      })),
    };
  } catch (err: any) {
    return {
      success: false,
      workspaceId,
      storageProvider: 'backblaze_b2',
      error: err.message,
      folderPrefix,
    };
  }
}
