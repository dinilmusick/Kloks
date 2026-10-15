/**
 * @file RemoteWorkspaceService.ts
 * @description Remote-first WorkspaceService implementation for Kloks.
 * Directly mediates with authoritative remote storage (Backblaze B2/S3/DB) without requiring local working files.
 * Canonical choice for DEPM. Conforms to Skipo Governance (< 200 lines).
 */

import {
  WorkspaceService,
  WorkspaceFileEntry,
  WorkspaceLookupResult,
  WorkspaceListResult,
  WorkspaceMutationResult,
} from './WorkspaceService.js';
import {
  findUserWorkspace,
  getWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../core/workspaceCore.js';
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  listWorkspaceFiles,
} from '../core/workspaceFileCore.js';

export class RemoteWorkspaceService implements WorkspaceService {
  public readonly type = 'remote' as const;

  async findWorkspace(workspaceId: string, env?: Record<string, unknown>): Promise<WorkspaceLookupResult> {
    return await findUserWorkspace(workspaceId, env);
  }

  async listWorkspaces(userId?: string, env?: Record<string, unknown>): Promise<WorkspaceListResult> {
    return await getWorkspaces(userId, env);
  }

  async createWorkspace(userId: string, data: any, env?: Record<string, unknown>): Promise<WorkspaceMutationResult> {
    return await createWorkspace(userId, data, env);
  }

  async updateWorkspace(userId: string, params: any, env?: Record<string, unknown>): Promise<WorkspaceMutationResult> {
    return await updateWorkspace(userId, params, env);
  }

  async deleteWorkspace(userId: string, workspaceId: string, env?: Record<string, unknown>): Promise<{ success: boolean; workspaces?: any[] }> {
    return await deleteWorkspace(userId, workspaceId, env);
  }

  async readFile(workspaceId: string, filePath: string, env?: Record<string, unknown>): Promise<Uint8Array | string> {
    const { workspace, connection } = await this.findWorkspace(workspaceId, env);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);
    const data = await readWorkspaceFile(workspace, connection, filePath);
    if (!data) throw new Error(`File "${filePath}" not found in workspace "${workspaceId}".`);
    return data;
  }

  async writeFile(
    workspaceId: string,
    filePath: string,
    content: Uint8Array | string,
    env?: Record<string, unknown>
  ): Promise<{ success: boolean; path: string; sizeBytes?: number }> {
    const { workspace, connection } = await this.findWorkspace(workspaceId, env);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);
    await writeWorkspaceFile(workspace, connection, filePath, content);
    const size = typeof content === 'string' ? new TextEncoder().encode(content).length : content.byteLength;
    return { success: true, path: filePath, sizeBytes: size };
  }

  async deleteFile(workspaceId: string, filePath: string, env?: Record<string, unknown>): Promise<{ success: boolean }> {
    const { workspace, connection } = await this.findWorkspace(workspaceId, env);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);
    const deleted = await deleteWorkspaceFile(workspace, connection, filePath);
    return { success: deleted };
  }

  async listFiles(workspaceId: string, subfolder = '', env?: Record<string, unknown>): Promise<WorkspaceFileEntry[]> {
    const { workspace, connection } = await this.findWorkspace(workspaceId, env);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);
    const files = await listWorkspaceFiles(workspace, connection, subfolder);
    return files.map((f) => ({
      path: f.fileName,
      name: f.fileName.split('/').pop() || f.fileName,
      sizeBytes: f.sizeBytes,
      updatedAt: f.uploadTimestamp,
    }));
  }
}

export const remoteWorkspaceService = new RemoteWorkspaceService();
