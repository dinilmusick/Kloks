/**
 * @file workspace.test.ts
 * @description Architecture tests verifying:
 * 1. worker -> facade -> service dispatch works end-to-end
 * 2. component -> facade direct access is forbidden (Negative test)
 * 3. worker -> service direct dispatch is rejected / facade is mandatory
 * 4. WorkspaceService contract with RemoteWorkspaceService and WorkingWorkspaceService
 */

import { describe, it, expect } from 'vitest';
import {
  ExecutableBackendFacade,
  ServiceDispatcher,
  WorkerExecutionBoundary,
  createOperationComponent,
} from '../packages/backend/src/execution/index.js';
import {
  RemoteWorkspaceService,
  remoteWorkspaceService,
} from '../packages/backend/src/workspace/RemoteWorkspaceService.js';
import {
  WorkingWorkspaceService,
  workingWorkspaceService,
} from '../packages/backend/src/workspace/WorkingWorkspaceService.js';
import type { WorkspaceService } from '../packages/backend/src/workspace/WorkspaceService.js';

describe('Canonical Execution & Workspace Architecture', () => {
  it('enforces worker -> backend facade -> service dispatch path', async () => {
    const facade = new ExecutableBackendFacade('TestAppBackend');

    // Register a domain service on the facade
    const projectService = new ServiceDispatcher('project');
    let serviceExecuted = false;

    projectService.registerOperation(
      'create',
      createOperationComponent('create', async (payload: { name: string }) => {
        serviceExecuted = true;
        return { id: 'p_123', name: payload.name, created: true };
      })
    );
    facade.registerService(projectService);

    // WorkerExecutionBoundary mediates worker dispatch
    const worker = new WorkerExecutionBoundary('worker_test_1', facade);

    const command = {
      id: 'cmd_1',
      type: 'project.create',
      payload: { name: 'Alpha Project' },
      correlationId: 'corr_test_1',
      createdAt: Date.now(),
    };

    const result = await worker.processJob(command);

    expect(result.status).toBe('COMPLETED');
    expect(result.correlationId).toBe('corr_test_1');
    expect(result.data).toEqual({ id: 'p_123', name: 'Alpha Project', created: true });
    expect(serviceExecuted).toBe(true);
  });

  it('NEGATIVE TEST: rejects direct component -> backend facade execution without worker context', async () => {
    const facade = new ExecutableBackendFacade('TestAppBackend');
    const service = new ServiceDispatcher('test');
    service.registerOperation(
      'run',
      createOperationComponent('run', async () => ({ ok: true }))
    );
    facade.registerService(service);

    const command = {
      id: 'cmd_direct',
      type: 'test.run',
      payload: {},
      correlationId: 'corr_direct',
      createdAt: Date.now(),
    };

    // Attempting direct execution with empty/non-worker context
    const fakeComponentContext = { isWorkerContext: false, timestamp: Date.now() };
    const result = await facade.executeCommand(command, fakeComponentContext);

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('WORKER_ONLY');
  });

  it('NEGATIVE TEST: WorkerExecutionBoundary asserts worker context and rejects non-worker callers', () => {
    expect(() => {
      WorkerExecutionBoundary.assertWorkerContext(undefined);
    }).toThrow(/forbidden.*Only BullMQ Workers may execute backend commands/i);

    expect(() => {
      WorkerExecutionBoundary.assertWorkerContext({ isWorkerContext: false, timestamp: Date.now() });
    }).toThrow(/forbidden.*Only BullMQ Workers may execute backend commands/i);
  });

  it('RemoteWorkspaceService conforms to WorkspaceService contract', () => {
    const service: WorkspaceService = remoteWorkspaceService;
    expect(service.type).toBe('remote');
    expect(typeof service.findWorkspace).toBe('function');
    expect(typeof service.listWorkspaces).toBe('function');
    expect(typeof service.createWorkspace).toBe('function');
    expect(typeof service.readFile).toBe('function');
    expect(typeof service.writeFile).toBe('function');
    expect(typeof service.deleteFile).toBe('function');
    expect(typeof service.listFiles).toBe('function');
  });

  it('WorkingWorkspaceService conforms to WorkspaceService contract and supports sync', () => {
    const service: WorkspaceService = workingWorkspaceService;
    expect(service.type).toBe('working');
    expect(typeof service.findWorkspace).toBe('function');
    expect(typeof service.listWorkspaces).toBe('function');
    expect(typeof service.createWorkspace).toBe('function');
    expect(typeof service.readFile).toBe('function');
    expect(typeof service.writeFile).toBe('function');
    expect(typeof service.deleteFile).toBe('function');
    expect(typeof service.listFiles).toBe('function');
    expect(typeof service.sync).toBe('function');
  });
});
