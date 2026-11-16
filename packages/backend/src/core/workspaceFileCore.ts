/**
 * @file workspaceFileCore.ts
 * @description Universal Workspace File IO Abstraction.
 * Routes reads, writes, and deletions to Local Disk or Backblaze B2 Object Storage (< 200 lines).
 */

import { b2UploadFile, b2DownloadFile, b2ListFileNames, b2DeleteFileVersion, b2DeleteFolder } from './b2DirectCore';
import { createGoogleDriveWorkspaceClient } from './storageConnectionCore.js';
import { queryUnifiedDb } from './unifiedDb.js';

declare const process: any;

async function getFs(): Promise<any> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const mod = await import('node:fs');
      return mod.promises || mod.default?.promises || mod;
    } catch {}
  }
  return null;
}

async function getPath(): Promise<any> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const mod = await import('node:path');
      return mod.default || mod;
    } catch {}
  }
  return null;
}

export function getWorkspaceFolderPrefix(workspace: any): string {
  return workspace.localFolderKey || workspace.localFolderName || (workspace.workspacePath ? workspace.workspacePath.replace(/^\.\//, '') : workspace.id);
}

export function isB2Workspace(workspace: any, connection: any): boolean {
  return (
    connection?.provider === 'backblaze_b2' ||
    connection?.provider === 'BACKBLAZE_B2' ||
    workspace?.storageProvider === 'backblaze_b2'
  );
}

async function getGoogleDriveClient(
  workspace: any,
  connection: any,
  env?: Record<string, unknown>,
) {
  const userId = String(connection?.__ownerUserId || workspace?.__ownerUserId || '').trim();
  const connectionId = String(connection?.id || workspace?.storageConnectionId || '').trim();
  if (!userId || !connectionId) {
    throw new Error('Google Drive workspace operations require an owned storage connection reference.');
  }
  return createGoogleDriveWorkspaceClient(
    userId,
    connectionId,
    (sql, params) => queryUnifiedDb(sql, params, env),
    workspace?.googleRootFolderId || connection?.googleRootFolderId || 'root',
  );
}

function isGoogleDriveWorkspace(workspace: any, connection: any): boolean {
  return connection?.provider === 'google_drive' || workspace?.storageProvider === 'google_drive';
}

export async function writeWorkspaceFile(
  workspace: any,
  connection: any,
  relativePath: string,
  content: string | Uint8Array,
  contentType = 'application/json',
  env?: Record<string, unknown>,
): Promise<void> {
  const cleanRel = relativePath.replace(/^\/+/, '');
  const prefix = getWorkspaceFolderPrefix(workspace);
  const buffer = typeof content === 'string' ? new TextEncoder().encode(content) : content;

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    await drive.write(cleanRel, buffer, contentType);
    return;
  }

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    try { return await drive.read(cleanRel); } catch (error) {
      if (error instanceof Error && /not found|HTTP 404/i.test(error.message)) return null;
      throw error;
    }
  }

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    await drive.delete(cleanRel);
    return true;
  }

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    const files = await drive.list(subPrefix);
    return files.map((file) => ({
      fileName: file.path,
      sizeBytes: file.size,
      uploadTimestamp: file.modifiedAt,
    }));
  }

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    const files = await drive.list('');
    for (const file of files) {
      if (!file.isFolder) await drive.delete(file.path);
    }
    return;
  }

  if (isB2Workspace(workspace, connection)) {
    const keyId = connection.b2KeyId || connection.keyId;
    const appKey = connection.b2ApplicationKey || connection.appKey;
    const bucketName = connection.b2BucketName || connection.bucketName || workspace.b2BucketName;
    if (!bucketName) throw new Error('The Backblaze workspace has no selected bucket.');
    const fullKey = `${prefix}/${cleanRel}`;
    await b2UploadFile(keyId, appKey, bucketName, fullKey, buffer, contentType);
    return;
  }

  // Local filesystem fallback
  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) throw new Error('Local filesystem operations not supported in this runtime.');
  const localDir = path.resolve(process.cwd(), prefix, path.dirname(cleanRel));
  await fs.mkdir(localDir, { recursive: true });
  await fs.writeFile(path.resolve(process.cwd(), prefix, cleanRel), buffer);
}

export async function readWorkspaceFile(
  workspace: any,
  connection: any,
  relativePath: string,
  env?: Record<string, unknown>,
): Promise<Uint8Array | null> {
  const cleanRel = relativePath.replace(/^\/+/, '');
  const prefix = getWorkspaceFolderPrefix(workspace);

  if (isB2Workspace(workspace, connection)) {
    const keyId = connection.b2KeyId || connection.keyId;
    const appKey = connection.b2ApplicationKey || connection.appKey;
    const bucketName = connection.b2BucketName || connection.bucketName || workspace.b2BucketName;
    if (!bucketName) throw new Error('The Backblaze workspace has no selected bucket.');
    const fullKey = `${prefix}/${cleanRel}`;
    return await b2DownloadFile(keyId, appKey, bucketName, fullKey);
  }

  // Local filesystem fallback
  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return null;
  const fullPath = path.resolve(process.cwd(), prefix, cleanRel);
  try {
    const buf = await fs.readFile(fullPath);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function deleteWorkspaceFile(
  workspace: any,
  connection: any,
  relativePath: string,
  env?: Record<string, unknown>,
): Promise<boolean> {
  const cleanRel = relativePath.replace(/^\/+/, '');
  const prefix = getWorkspaceFolderPrefix(workspace);

  if (isB2Workspace(workspace, connection)) {
    const keyId = connection.b2KeyId || connection.keyId;
    const appKey = connection.b2ApplicationKey || connection.appKey;
    const bucketName = connection.b2BucketName || connection.bucketName || workspace.b2BucketName;
    if (!bucketName) throw new Error('The Backblaze workspace has no selected bucket.');
    const fullKey = `${prefix}/${cleanRel}`;
    const files = await b2ListFileNames(keyId, appKey, bucketName, fullKey);
    const match = files.find((f) => f.fileName === fullKey);
    if (match) {
      await b2DeleteFileVersion(keyId, appKey, match.fileName, match.fileId);
      return true;
    }
    return false;
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return false;
  const fullPath = path.resolve(process.cwd(), prefix, cleanRel);
  try {
    await fs.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function listWorkspaceFiles(
  workspace: any,
  connection: any,
  subPrefix = '',
  env?: Record<string, unknown>,
): Promise<Array<{ fileName: string; sizeBytes: number; uploadTimestamp?: number }>> {
  const folderPrefix = getWorkspaceFolderPrefix(workspace);
  const targetPrefix = subPrefix ? `${folderPrefix}/${subPrefix.replace(/^\/+/, '')}` : `${folderPrefix}/`;

  if (isB2Workspace(workspace, connection)) {
    const keyId = connection.b2KeyId || connection.keyId;
    const appKey = connection.b2ApplicationKey || connection.appKey;
    const bucketName = connection.b2BucketName || connection.bucketName || workspace.b2BucketName;
    if (!bucketName) throw new Error('The Backblaze workspace has no selected bucket.');
    const rawFiles = await b2ListFileNames(keyId, appKey, bucketName, targetPrefix);
    return rawFiles.map((f) => ({
      fileName: f.fileName.slice(folderPrefix.length + 1),
      sizeBytes: f.contentLength,
      uploadTimestamp: f.uploadTimestamp,
    }));
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return [];
  const baseDir = path.resolve(process.cwd(), folderPrefix, subPrefix);
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true, recursive: true });
    const result: Array<{ fileName: string; sizeBytes: number }> = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        const full = path.join(entry.parentPath || baseDir, entry.name);
        const st = await fs.stat(full);
        result.push({
          fileName: path.relative(path.resolve(process.cwd(), folderPrefix), full),
          sizeBytes: st.size,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export async function deleteWorkspaceFolder(
  workspace: any,
  connection: any,
  env?: Record<string, unknown>,
): Promise<void> {
  const prefix = getWorkspaceFolderPrefix(workspace);
  if (isB2Workspace(workspace, connection)) {
    const keyId = connection.b2KeyId || connection.keyId;
    const appKey = connection.b2ApplicationKey || connection.appKey;
    const bucketName = connection.b2BucketName || connection.bucketName || workspace.b2BucketName;
    if (!bucketName) throw new Error('The Backblaze workspace has no selected bucket.');
    await b2DeleteFolder(keyId, appKey, bucketName, prefix);
    return;
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return;
  const localDir = path.resolve(process.cwd(), prefix);
  try {
    await fs.rm(localDir, { recursive: true, force: true });
  } catch {}
}
