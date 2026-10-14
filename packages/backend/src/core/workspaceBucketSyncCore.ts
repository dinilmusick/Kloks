/**
 * @file workspaceBucketSyncCore.ts
 * @description Workspace Backblaze B2 Direct Storage Synchronization.
 * Directly handles folder creation, file uploads (workspace.json, ecosystem.json), and cleanup.
 * Conforms to Law L2, L3, L9 (< 200 lines).
 */

import { writeWorkspaceFile, deleteWorkspaceFolder } from './workspaceFileCore';

export function resolveWorkspaceConnection(profiles: any, workspace: any) {
  const depm = profiles.depm || {};
  const conns = depm.storage_connections?.length
    ? depm.storage_connections
    : profiles.srkl?.storage_connections || profiles.docustack?.storage_connections || [];
  return conns.find((c: any) => c.id === workspace.storageConnectionId)
    || conns.find((c: any) => c.role === 'primary')
    || conns[0]
    || null;
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
