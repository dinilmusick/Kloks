/**
 * @file workspaceBucketSyncCore.ts
 * @description Workspace Backblaze B2 Direct Storage Synchronization.
 * Directly handles folder creation, file uploads (workspace.json, ecosystem.json), and cleanup.
 * Conforms to Law L2, L3, L9 (< 200 lines).
 */

import { writeWorkspaceFile, deleteWorkspaceFolder } from './workspaceFileCore';

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
    // A declared connection ID is an immutable association. Never silently
    // substitute a different primary account if that reference is invalid.
    return connections.find((connection) => connection.id === workspace.storageConnectionId) || null;
  }
  return connections.find((connection) => connection.role === 'primary') || connections[0] || null;
}

export async function syncWorkspaceCreateToBucket(workspace: any, connection: any, env?: Record<string, unknown>) {
  if (!connection || (connection.provider !== 'backblaze_b2' && connection.provider !== 'BACKBLAZE_B2')) return;
  try {
    const wsMeta = {
      id: workspace.id,
      name: workspace.name,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      storageProvider: 'backblaze_b2',
      bucket: connection.b2BucketName || 'ultrst-apps',
    };

    // Upload folder marker .bzEmpty
    await writeWorkspaceFile(workspace, connection, '.bzEmpty', new Uint8Array(0), 'application/x-empty');
    // Upload workspace.json
    await writeWorkspaceFile(workspace, connection, 'workspace.json', JSON.stringify(wsMeta, null, 2), 'application/json');
    // Upload ecosystem.json
    await writeWorkspaceFile(
      workspace,
      connection,
      'ecosystem.json',
      JSON.stringify({ apps: [], nodes: [], edges: [], ecosystems: [] }, null, 2),
      'application/json'
    );
  } catch (err: any) {
    console.warn('[WorkspaceBucketSync] Create sync error:', err.message);
  }
}

export async function syncWorkspaceDeleteToBucket(workspace: any, connection: any, env?: Record<string, unknown>) {
  if (!connection || (connection.provider !== 'backblaze_b2' && connection.provider !== 'BACKBLAZE_B2')) return;
  try {
    await deleteWorkspaceFolder(workspace, connection);
  } catch (err: any) {
    console.warn('[WorkspaceBucketSync] Delete sync error:', err.message);
  }
}

export async function syncWorkspaceDataToBucket(workspace: any, connection: any, data: any, env?: Record<string, unknown>) {
  if (!connection || (connection.provider !== 'backblaze_b2' && connection.provider !== 'BACKBLAZE_B2')) return;
  try {
    await writeWorkspaceFile(workspace, connection, 'ecosystem.json', JSON.stringify(data, null, 2), 'application/json');
  } catch (err: any) {
    console.warn('[WorkspaceBucketSync] Data sync error:', err.message);
  }
}
