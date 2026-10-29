/**
 * @file workspaceCore.ts
 * @description Universal Workspace Core Service for DEPM.
 * Governs workspaces CRUD and Workspace Cloud Storage (Backblaze B2 via SRKL).
 * Runs identically in Node.js, Vercel Serverless, and Cloudflare Workers (< 200 lines).
 */

import { queryUnifiedDb } from './unifiedDb';

function workspaceAppId(env?: Record<string, unknown>): string {
  const value = String(env?.WORKSPACE_APP_ID ?? 'depm').trim().toLowerCase();
  return value || 'depm';
}

function appProfile(profiles: Record<string, any>, appId: string): Record<string, any> {
  if (!profiles[appId] || typeof profiles[appId] !== 'object') profiles[appId] = {};
  return profiles[appId];
}
import { resolveWorkspaceConnection, syncWorkspaceCreateToBucket, syncWorkspaceDeleteToBucket } from './workspaceBucketSyncCore';
export { loadWorkspaceData, saveWorkspaceData, renameAppInWorkspaceData } from './workspaceDataCore';
export { getWorkspaceStorageDetails } from './workspaceStorageDetailsCore';

export async function findUserWorkspace(workspaceId: string, env?: Record<string, unknown>) {
  const res = await queryUnifiedDb(`SELECT id, email, username, app_profiles FROM "ultrst-users"`, [], env);
  for (const user of res.rows) {
    const profiles = typeof user.app_profiles === 'string' ? JSON.parse(user.app_profiles) : (user.app_profiles || {});
    const app = appProfile(profiles, workspaceAppId(env));
    const workspaces = Array.isArray(app.workspaces) ? app.workspaces : [];
    const ws = workspaces.find((w: any) => w.id === workspaceId);
    if (ws) {
      const conns = app.storage_connections || profiles.srkl?.storage_connections || profiles.docustack?.storage_connections || [];
      const conn = conns.find((c: any) => c.id === ws.storageConnectionId) || conns.find((c: any) => c.role === 'primary') || conns[0] || null;
      return { user, workspace: ws, connection: conn };
    }
  }
  return { user: null, workspace: null, connection: null };
}

export async function getWorkspaces(userId?: string, env?: Record<string, unknown>) {
  if (!userId) {
    return { success: true, workspaces: [], activeWorkspaceId: null, storage_connections: [] };
  }
  const res = await queryUnifiedDb(`SELECT * FROM "ultrst-users" WHERE id = $1 OR email = $1 LIMIT 1`, [userId], env);
  const userRow = res.rows[0];
  if (!userRow) {
    return { success: true, workspaces: [], activeWorkspaceId: null, storage_connections: [] };
  }

  const profiles = typeof userRow.app_profiles === 'string' ? JSON.parse(userRow.app_profiles) : (userRow.app_profiles || {});
  const app = appProfile(profiles, workspaceAppId(env));
  const workspaces = Array.isArray(app.workspaces) ? app.workspaces : [];
  const activeWorkspaceId = app.activeWorkspaceId || null;
  const conns = app.storage_connections?.length ? app.storage_connections : (profiles.srkl?.storage_connections || []);

  return { success: true, workspaces, activeWorkspaceId, storage_connections: conns };
}

export async function createWorkspace(userId: string, wsData: any, env?: Record<string, unknown>) {
  const uRes = await queryUnifiedDb(`SELECT * FROM "ultrst-users" WHERE id = $1`, [userId], env);
  const user = uRes.rows[0];
  if (!user) throw new Error('User account not found.');

  const profiles = typeof user.app_profiles === 'string' ? JSON.parse(user.app_profiles) : (user.app_profiles || {});
  const app = appProfile(profiles, workspaceAppId(env));
  const workspaces = Array.isArray(app.workspaces) ? app.workspaces : [];

  const wsName = (wsData.name || 'New Workspace').trim();
  const wsId = wsData.id || `ws-depm-${Date.now()}`;
  const userName = user.username || user.name || 'user';
  const folderKey = `ultrst_depm_${userName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${wsName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

  const newWs = {
    ...wsData,
    id: wsId,
    name: wsName,
    localFolderName: folderKey,
    localFolderKey: folderKey,
    workspacePath: `./${folderKey}`,
    storageProvider: wsData.storageProvider || 'backblaze_b2',
    b2BucketName: wsData.b2BucketName || 'ultrst-apps',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  workspaces.push(newWs);
  app.workspaces = workspaces;
  app.activeWorkspaceId = wsId;

  await queryUnifiedDb(`UPDATE "ultrst-users" SET app_profiles = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(profiles), user.id], env);
  const conn = resolveWorkspaceConnection(profiles, newWs);
  await syncWorkspaceCreateToBucket(newWs, conn, env);
  return { success: true, workspace: newWs, workspaces };
}

export async function updateWorkspace(userId: string, params: any, env?: Record<string, unknown>) {
  const uRes = await queryUnifiedDb(`SELECT * FROM "ultrst-users" WHERE id = $1`, [userId], env);
  const user = uRes.rows[0];
  if (!user) throw new Error('User not found.');

  const profiles = typeof user.app_profiles === 'string' ? JSON.parse(user.app_profiles) : (user.app_profiles || {});
  const app = appProfile(profiles, workspaceAppId(env));
  const workspaces = Array.isArray(app.workspaces) ? app.workspaces : [];

  const { action, workspaceId, updates } = params;
  const targetId = workspaceId || updates?.id;
  const match = workspaces.find((w: any) => w.id === targetId);
  if (!match) throw new Error('Workspace not found.');

  if (action === 'switch') {
    app.activeWorkspaceId = targetId;
  } else {
    // ENFORCE IMMUTABILITY: storage fields cannot be altered post-creation
    const safeUpdates = { ...(updates || params) };
    delete safeUpdates.storageProvider;
    delete safeUpdates.storageConnectionId;
    delete safeUpdates.b2BucketName;
    delete safeUpdates.b2Endpoint;
    delete safeUpdates.b2Region;
    delete safeUpdates.localFolderName;
    delete safeUpdates.localFolderKey;
    delete safeUpdates.workspacePath;
    delete safeUpdates.primaryStorage;
    delete safeUpdates.id;
    delete safeUpdates.action;
    delete safeUpdates.workspaceId;
    Object.assign(match, safeUpdates, { updatedAt: new Date().toISOString() });
  }

  await queryUnifiedDb(`UPDATE "ultrst-users" SET app_profiles = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(profiles), user.id], env);
  return { success: true, workspace: match, workspaces };
}

export async function deleteWorkspace(userId: string, wsId: string, env?: Record<string, unknown>) {
  const uRes = await queryUnifiedDb(`SELECT * FROM "ultrst-users" WHERE id = $1`, [userId], env);
  const user = uRes.rows[0];
  if (!user) throw new Error('User not found.');

  const profiles = typeof user.app_profiles === 'string' ? JSON.parse(user.app_profiles) : (user.app_profiles || {});
  const app = appProfile(profiles, workspaceAppId(env));
  if (!app.workspaces) return { success: true, workspaces: [] };

  const targetWs = app.workspaces.find((w: any) => w.id === wsId);
  const conn = targetWs ? resolveWorkspaceConnection(profiles, targetWs) : null;

  app.workspaces = app.workspaces.filter((w: any) => w.id !== wsId);
  if (app.activeWorkspaceId === wsId) {
    app.activeWorkspaceId = app.workspaces[0]?.id || null;
  }
  if (app.workspace_data?.[wsId]) {
    delete app.workspace_data[wsId];
  }

  await queryUnifiedDb(`UPDATE "ultrst-users" SET app_profiles = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(profiles), user.id], env);
  if (targetWs && conn) {
    await syncWorkspaceDeleteToBucket(targetWs, conn, env);
  }
  return { success: true, workspaces: app.workspaces };
}
