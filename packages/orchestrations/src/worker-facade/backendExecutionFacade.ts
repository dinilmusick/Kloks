/**
 * @file backendExecutionFacade.ts
 * @description Registers backend services on ExecutableBackendFacade and connects BullMQ workers.
 * Enforces SKIPO::STATE_EXECUTION_ARCHITECTURE (Worker-only access to Backend Facade).
 */

import {
  ExecutableBackendFacade,
  WorkerExecutionBoundary,
  ServiceDispatcher,
  createOperationComponent,
} from '@kloks/backend/execution';
import { SKIPO_EXECUTION } from '@kloks/state-graph';

export class WorkspaceBackendFacade extends ExecutableBackendFacade {}

export const backendFacade = new WorkspaceBackendFacade('WorkspaceBackendFacade');


// 1. Project Service
const projectService = new ServiceDispatcher('project');

projectService.registerOperation(
  'list',
  createOperationComponent<{ workspaceId?: string } | void, any>('list', async (input) => {
    const wsId = input && typeof input === 'object' && 'workspaceId' in input ? input.workspaceId : undefined;
    const url = wsId ? `/api/workspaces/${encodeURIComponent(wsId)}/graphs` : '/api/projects';
    const res = await fetch(url);
    return await res.json();
  })
);

projectService.registerOperation(
  'get',
  createOperationComponent<{ id: string; workspaceId?: string }, any>('get', async (input) => {
    const url = input.workspaceId
      ? `/api/workspaces/${encodeURIComponent(input.workspaceId)}/graphs/${encodeURIComponent(input.id)}`
      : `/api/projects/${input.id}`;
    const res = await fetch(url);
    return await res.json();
  })
);

projectService.registerOperation(
  'save',
  createOperationComponent<{ id: string; projectData: any; workspaceId?: string }, any>('save', async (input) => {
    const url = input.workspaceId
      ? `/api/workspaces/${encodeURIComponent(input.workspaceId)}/graphs/${encodeURIComponent(input.id)}`
      : `/api/projects/${input.id}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.projectData),
    });
    return await res.json();
  })
);

projectService.registerOperation(
  'create',
  createOperationComponent<any, any>('create', async (input) => {
    const wsId = input?.workspaceId;
    const url = wsId ? `/api/workspaces/${encodeURIComponent(wsId)}/graphs` : '/api/projects';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return await res.json();
  })
);

projectService.registerOperation(
  'delete',
  createOperationComponent<{ id: string; workspaceId?: string }, any>('delete', async (input) => {
    const url = input.workspaceId
      ? `/api/workspaces/${encodeURIComponent(input.workspaceId)}/graphs/${encodeURIComponent(input.id)}`
      : `/api/projects/${input.id}`;
    const res = await fetch(url, {
      method: 'DELETE',
    });
    return await res.json();
  })
);

// 2. Sample Service
const sampleService = new ServiceDispatcher('sample');

sampleService.registerOperation(
  'list',
  createOperationComponent<{ projectId?: string } | void, any>('list', async (input) => {
    const projectId = input && typeof input === 'object' && 'projectId' in input ? input.projectId : null;
    const globalRes = await fetch('/api/samples/global');
    const globalData = await globalRes.json();

    let projectSamples: any[] = [];
    if (projectId) {
      try {
        const projRes = await fetch(`/api/samples/projects/${encodeURIComponent(projectId)}/samples`);
        const projData = await projRes.json();
        projectSamples = projData.samples || [];
      } catch (err) {
        console.error('Failed to fetch project samples in facade:', err);
      }
    }

    return {
      globalSamples: globalData.samples || [],
      projectSamples,
    };
  })
);

sampleService.registerOperation(
  'upload',
  createOperationComponent<FormData, any>('upload', async (input) => {
    const res = await fetch('/api/samples', {
      method: 'POST',
      body: input,
    });
    return await res.json();
  })
);

sampleService.registerOperation(
  'delete',
  createOperationComponent<{ id: string }, any>('delete', async (input) => {
    const res = await fetch(`/api/samples/${input.id}`, {
      method: 'DELETE',
    });
    return await res.json();
  })
);

// 3. Asset Pool Service
const assetPoolService = new ServiceDispatcher('asset');

assetPoolService.registerOperation(
  'listPool',
  createOperationComponent<{ scope: 'workspace' | 'project'; projectId?: string }, any>('listPool', async (input) => {
    const params = new URLSearchParams();
    if (input?.scope) params.set('scope', input.scope);
    if (input?.projectId) params.set('projectId', input.projectId);
    const res = await fetch(`/api/assets/pools?${params.toString()}`);
    return await res.json();
  })
);

assetPoolService.registerOperation(
  'createFolder',
  createOperationComponent<{ scope: 'workspace' | 'project'; projectId?: string; dataType: 'audio' | 'midi'; channelType?: 'stereo' | 'mono'; folderName: string }, any>(
    'createFolder',
    async (input) => {
      const res = await fetch('/api/assets/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return await res.json();
    }
  )
);

assetPoolService.registerOperation(
  'upload',
  createOperationComponent<any, any>('upload', async (input) => {
    const res = await fetch('/api/assets/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return await res.json();
  })
);

assetPoolService.registerOperation(
  'delete',
  createOperationComponent<any, any>('delete', async (input) => {
    const params = new URLSearchParams(input);
    const res = await fetch(`/api/assets/file?${params.toString()}`, {
      method: 'DELETE',
    });
    return await res.json();
  })
);

// Register Services
backendFacade.registerService(projectService);
backendFacade.registerService(sampleService);
backendFacade.registerService(assetPoolService);

// 3. Worker Execution Boundary (Enforces worker context)
export const workerExecutionBoundary = new WorkerExecutionBoundary('workspace_worker_pool_1', backendFacade);

// Connect Worker Execution Boundary to SKIPO_EXECUTION BullMQ Dispatcher
(SKIPO_EXECUTION as any).registerWorkerHandler?.(async (command: any) => {
  return await workerExecutionBoundary.processJob(command);
});
