/**
 * @file WorkerExecutionBoundary.ts
 * @description Worker execution boundary enforcing worker-only access to Backend Facade.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

import { BackendCommand, ExecutionContext, NormalizedResult } from './types.js';
import { ExecutableBackendFacade } from './BackendFacade.js';

export class WorkerExecutionBoundary {
  constructor(
    public readonly workerId: string,
    private facade: ExecutableBackendFacade
  ) {}

  async processJob<T = unknown>(command: BackendCommand<any>): Promise<NormalizedResult<T>> {
    const context: ExecutionContext = {
      isWorkerContext: true,
      workerId: this.workerId,
      timestamp: Date.now(),
    };

    return await this.facade.executeCommand<T>(command, context);
  }

  static assertWorkerContext(context?: ExecutionContext): void {
    if (!context || !context.isWorkerContext) {
      throw new Error(
        '[WorkerExecutionBoundary] Violation: DIRECT_COMPONENT -> BACKEND_FACADE is forbidden. Only BullMQ Workers may execute backend commands.'
      );
    }
  }
}
