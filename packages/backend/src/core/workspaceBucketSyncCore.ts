/**
 * @file workspaceBucketSyncCore.ts
 * @description Initialize and synchronize workspace metadata to the exact
 * user-owned storage connection associated with a workspace.
 */

import { writeWorkspaceFile, deleteWorkspaceFolder } from './workspaceFileCore.js';

export function resolveWorkspaceConnection(profiles: any, workspace: any, appId = 'depm') {
  const collections: any[][] = [];
  const preferred = profiles?.[String(appId || 'depm').toLowerCase()]?.storage_connections;
  if (Array.isArray(preferred)) collections.push(preferred);

  for (const value of Object.values(profiles || {})) {
    if (value && typeof value === 'object' && Array.isArray((value as any).storage_connections)) {
      collections.push((value as any).storage_connections);
    }
  }

  const byId = new Map<string, any>();
  for (const connection of collections.flat()) {
    if (connection && typeof connection.id === 'string' && !byId.has(connection.id)) {
      byId.set(connection.id, connection);
    }
  }
  const connections = [...byId.values()];

  if (workspace?.storageConnectionId) {
    return connections.find((connection) => connection.id === workspace.storageConnectionId) || null;
  }
  return connections.find((connection) => connection.role === 'primary') || connections[0] || null;
}

function isPersistentCloudConnection(connection: any): boolean {
  return connection?.provider === 'backblaze_b2' || connection?.provider === 'google_drive';
}

export async function syncWorkspaceCreateToBucket(
  workspace: any,
  connection: any,
  env?: Record<string, unknown>,
): Promise<void> {
  const provider = String(connection?.provider || workspace?.storageProvider || '').toLowerCase();
  if (provider === 'local_fs') return;
  if (!isPersistentCloudConnection(connection) || workspace?.storageConnectionId !== connection?.id) {
    throw new Error('Workspace initialization requires its exact, verified persistent storage connection.');
  }

  const metadata = {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    storageProvider: provider,
    storageConnectionId: connection.id,
    ...(provider === 'backblaze_b2' ? {
      bucket: connection.b2BucketName || connection.bucketName || workspace.b2BucketName,
    } : {
      rootFolderId: workspace.googleRootFolderId || connection.googleRootFolderId,
    }),
  };

  if (provider === 'backblaze_b2' && !metadata.bucket) {
    throw new Error('Backblaze B2 workspace initialization requires a selected bucket.');
  }
  if (provider === 'google_drive' && !metadata.rootFolderId) {
    throw new Error('Google Drive workspace initialization requires a selected root folder.');
  }

  await writeWorkspaceFile(workspace, connection, '.bzEmpty', new Uint8Array(0), 'application/x-empty', env);
  await writeWorkspaceFile(workspace, connection, 'workspace.json', JSON.stringify(metadata, null, 2), 'application/json', env);
  await writeWorkspaceFile(
    workspace,
    connection,
    'ecosystem.json',
    JSON.stringify({ apps: [], nodes: [], edges: [], ecosystems: [] }, null, 2),
    'application/json',
    env,
  );
}

export async function syncWorkspaceDeleteToBucket(
  workspace: any,
  connection: any,
  env?: Record<string, unknown>,
): Promise<void> {
  if (!isPersistentCloudConnection(connection)) return;
  await deleteWorkspaceFolder(workspace, connection, env);
}

export async function syncWorkspaceDataToBucket(
  workspace: any,
  connection: any,
  data: any,
  env?: Record<string, unknown>,
): Promise<void> {
  if (!isPersistentCloudConnection(connection)) return;
  await writeWorkspaceFile(
    workspace,
    connection,
    'ecosystem.json',
    JSON.stringify(data, null, 2),
    'application/json',
    env,
  );
}
