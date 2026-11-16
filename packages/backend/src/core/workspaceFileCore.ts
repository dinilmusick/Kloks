/**
 * @file workspaceFileCore.ts
 * @description Fetch-compatible workspace file IO for B2, Google Drive, and local storage.
 * Node filesystem modules are loaded only by guarded dynamic imports; the Worker
 * path uses the Web Fetch-based Kloks provider adapters.
 */

import { b2UploadFile, b2DownloadFile, b2ListFileNames, b2DeleteFileVersion, b2DeleteFolder } from './b2DirectCore.js';
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
  return workspace.localFolderKey
    || workspace.localFolderName
    || (workspace.workspacePath ? workspace.workspacePath.replace(/^\.\//, '') : workspace.id);
}

export function isB2Workspace(workspace: any, connection: any): boolean {
  return connection?.provider === 'backblaze_b2'
    || connection?.provider === 'BACKBLAZE_B2'
    || workspace?.storageProvider === 'backblaze_b2';
}

export function isGoogleDriveWorkspace(workspace: any, connection: any): boolean {
  return connection?.provider === 'google_drive'
    || workspace?.storageProvider === 'google_drive';
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

function getB2Settings(workspace: any, connection: any): {
  keyId: string;
  applicationKey: string;
  bucketName: string;
} {
  const keyId = String(connection?.b2KeyId || connection?.keyId || '').trim();
  const applicationKey = String(connection?.b2ApplicationKey || connection?.appKey || '').trim();
  const bucketName = String(connection?.b2BucketName || connection?.bucketName || workspace?.b2BucketName || '').trim();
  if (!keyId || !applicationKey || !bucketName) {
    throw new Error('The Backblaze workspace connection is missing its server-side credentials or bucket.');
  }
  return { keyId, applicationKey, bucketName };
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
  const folderPrefix = getWorkspaceFolderPrefix(workspace);
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    await drive.write(cleanRel, bytes, contentType);
    return;
  }

  if (isB2Workspace(workspace, connection)) {
    const config = getB2Settings(workspace, connection);
    await b2UploadFile(
      config.keyId,
      config.applicationKey,
      config.bucketName,
      `${folderPrefix}/${cleanRel}`,
      bytes,
      contentType,
    );
    return;
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) throw new Error('Local filesystem operations are not supported in this runtime.');
  const localDir = path.resolve(process.cwd(), folderPrefix, path.dirname(cleanRel));
  await fs.mkdir(localDir, { recursive: true });
  await fs.writeFile(path.resolve(process.cwd(), folderPrefix, cleanRel), bytes);
}

export async function readWorkspaceFile(
  workspace: any,
  connection: any,
  relativePath: string,
  env?: Record<string, unknown>,
): Promise<Uint8Array | null> {
  const cleanRel = relativePath.replace(/^\/+/, '');
  const folderPrefix = getWorkspaceFolderPrefix(workspace);

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    try {
      return await drive.read(cleanRel);
    } catch (error) {
      if (error instanceof Error && /not found|HTTP 404/i.test(error.message)) return null;
      throw error;
    }
  }

  if (isB2Workspace(workspace, connection)) {
    const config = getB2Settings(workspace, connection);
    return b2DownloadFile(config.keyId, config.applicationKey, config.bucketName, `${folderPrefix}/${cleanRel}`);
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return null;
  const fullPath = path.resolve(process.cwd(), folderPrefix, cleanRel);
  try {
    const file = await fs.readFile(fullPath);
    return new Uint8Array(file);
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
  const folderPrefix = getWorkspaceFolderPrefix(workspace);

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    await drive.delete(cleanRel);
    return true;
  }

  if (isB2Workspace(workspace, connection)) {
    const config = getB2Settings(workspace, connection);
    const fullKey = `${folderPrefix}/${cleanRel}`;
    const files = await b2ListFileNames(config.keyId, config.applicationKey, config.bucketName, fullKey);
    const match = files.find((file: any) => file.fileName === fullKey);
    if (!match) return false;
    await b2DeleteFileVersion(config.keyId, config.applicationKey, match.fileName, match.fileId);
    return true;
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return false;
  const fullPath = path.resolve(process.cwd(), folderPrefix, cleanRel);
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

  if (isGoogleDriveWorkspace(workspace, connection)) {
    const drive = await getGoogleDriveClient(workspace, connection, env);
    const files = await drive.list(subPrefix);
    return files.map((file) => ({
      fileName: file.path,
      sizeBytes: file.size,
      uploadTimestamp: file.modifiedAt,
    }));
  }

  if (isB2Workspace(workspace, connection)) {
    const config = getB2Settings(workspace, connection);
    const targetPrefix = subPrefix
      ? `${folderPrefix}/${subPrefix.replace(/^\/+/, '')}`
      : `${folderPrefix}/`;
    const files = await b2ListFileNames(config.keyId, config.applicationKey, config.bucketName, targetPrefix);
    return files.map((file: any) => ({
      fileName: String(file.fileName || '').slice(folderPrefix.length + 1),
      sizeBytes: Number(file.contentLength || 0),
      uploadTimestamp: file.uploadTimestamp,
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
        const stat = await fs.stat(full);
        result.push({
          fileName: path.relative(path.resolve(process.cwd(), folderPrefix), full),
          sizeBytes: stat.size,
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
  const folderPrefix = getWorkspaceFolderPrefix(workspace);

  if (isGoogleDriveWorkspace(workspace, connection)) {
    // The selected Drive root is user-owned and must not be recursively
    // deleted when an application workspace is removed.
    return;
  }

  if (isB2Workspace(workspace, connection)) {
    const config = getB2Settings(workspace, connection);
    await b2DeleteFolder(config.keyId, config.applicationKey, config.bucketName, folderPrefix);
    return;
  }

  const fs = await getFs();
  const path = await getPath();
  if (!fs || !path) return;
  const localDir = path.resolve(process.cwd(), folderPrefix);
  try {
    await fs.rm(localDir, { recursive: true, force: true });
  } catch {}
}
