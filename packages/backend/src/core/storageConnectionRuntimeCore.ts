/**
 * @file storageConnectionRuntimeCore.ts
 * @description Server-side workspace file operations against user-owned
 * storage connections. Connection secrets never cross this service boundary.
 */

import { queryUnifiedDb } from './unifiedDb.js';
import { resolveUserStorageConnectionSecret } from './storageConnectionCore.js';
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './workspaceFileCore.js';

type StorageQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, any>> }>;

function makeQuery(env?: Record<string, unknown>): StorageQuery {
  return (sql, params) => queryUnifiedDb(sql, params, env);
}

async function resolveWorkspaceContext(
  input: {
    userId: string;
    connectionId: string;
    folderPrefix: string;
    bucketName?: string;
    rootFolderId?: string;
  },
  query: StorageQuery,
) {
  const userId = String(input.userId || '').trim();
  const connectionId = String(input.connectionId || '').trim();
  if (!userId || !connectionId) {
    throw new Error('A verified user and storage connection ID are required.');
  }
  const connection = await resolveUserStorageConnectionSecret(userId, connectionId, query);
  if (!connection || connection.enabled === false) {
    throw new Error('The selected storage connection is unavailable for this user.');
  }
  const folderPrefix = String(input.folderPrefix || '').replace(/^\\/+|\\/+$/g, '');
  if (!folderPrefix) throw new Error('Workspace storage folder prefix is required.');

  const workspace = {
    id: 'storage-' + connectionId,
    name: 'Workspace',
    storageProvider: connection.provider,
    storageConnectionId: connection.id,
    localFolderKey: folderPrefix,
    workspacePath: './' + folderPrefix,
    ...(input.bucketName ? { b2BucketName: input.bucketName } : {}),
    ...(input.rootFolderId ? { googleRootFolderId: input.rootFolderId } : {}),
  };
  return {
    workspace,
    connection: {
      ...connection,
      __ownerUserId: userId,
      ...(input.bucketName && connection.provider === 'backblaze_b2'
        ? { b2BucketName: input.bucketName, bucketName: input.bucketName }
        : {}),
      ...(input.rootFolderId && connection.provider === 'google_drive'
        ? { googleRootFolderId: input.rootFolderId }
        : {}),
    },
  };
}

export async function writeUserWorkspaceStorageFile(
  input: {
    userId: string;
    connectionId: string;
    folderPrefix: string;
    relativePath: string;
    content: string | Uint8Array;
    contentType?: string;
    bucketName?: string;
    rootFolderId?: string;
    env?: Record<string, unknown>;
  },
): Promise<{ success: true }> {
  const context = await resolveWorkspaceContext(input, makeQuery(input.env));
  await writeWorkspaceFile(
    context.workspace,
    context.connection,
    input.relativePath,
    input.content,
    input.contentType || 'application/octet-stream',
    input.env,
  );
  return { success: true };
}

export async function readUserWorkspaceStorageFile(
  input: {
    userId: string;
    connectionId: string;
    folderPrefix: string;
    relativePath: string;
    bucketName?: string;
    rootFolderId?: string;
    env?: Record<string, unknown>;
  },
): Promise<Uint8Array | null> {
  const context = await resolveWorkspaceContext(input, makeQuery(input.env));
  return readWorkspaceFile(context.workspace, context.connection, input.relativePath, input.env);
}

export async function deleteUserWorkspaceStorageFile(
  input: {
    userId: string;
    connectionId: string;
    folderPrefix: string;
    relativePath: string;
    bucketName?: string;
    rootFolderId?: string;
    env?: Record<string, unknown>;
  },
): Promise<boolean> {
  const context = await resolveWorkspaceContext(input, makeQuery(input.env));
  return deleteWorkspaceFile(context.workspace, context.connection, input.relativePath, input.env);
}

export async function listUserWorkspaceStorageFiles(
  input: {
    userId: string;
    connectionId: string;
    folderPrefix: string;
    subPrefix?: string;
    bucketName?: string;
    rootFolderId?: string;
    env?: Record<string, unknown>;
  },
): Promise<Array<{ fileName: string; sizeBytes: number; uploadTimestamp?: number }>> {
  const context = await resolveWorkspaceContext(input, makeQuery(input.env));
  return listWorkspaceFiles(context.workspace, context.connection, input.subPrefix || '', input.env);
}
