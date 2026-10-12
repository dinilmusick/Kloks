/**
 * @file BackendFacade.ts
 * @description Single Public Execution Interface for the backend plane.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

import { BackendCommand, ExecutionContext, NormalizedResult } from './types.js';
import { ServiceDispatcher } from './ServiceDispatcher.js';
import { IdempotencyManager } from '../connectivity/IdempotencyManager.js';

export class ExecutableBackendFacade {
  private services = new Map<string, ServiceDispatcher>();
  private idempotency: IdempotencyManager;

  constructor(
    public readonly name: string,
    idempotency?: IdempotencyManager
  ) {
    this.idempotency = idempotency || new IdempotencyManager();
  }

  registerService(service: ServiceDispatcher): this {
    this.services.set(service.name, service);
    return this;
  }

  async executeCommand<T = unknown>(
    command: BackendCommand<any>,
    context: ExecutionContext
  ): Promise<NormalizedResult<T>> {
    const startTime = Date.now();

    // Enforce Invariant I11: FACADE_ACCESS := WORKER_ONLY
    if (!context || !context.isWorkerContext) {
      return {
        correlationId: command.correlationId,
        status: 'FAILED',
        error:
          '[BackendFacade] DIRECT_COMPONENT -> BACKEND_FACADE is strictly FORBIDDEN. Access allowed for WORKER_ONLY.',
        executionTimestamp: startTime,
      };
    }

    const runCore = async (): Promise<NormalizedResult<T>> => {
      try {
        const parts = command.type.split('.');
        if (parts.length < 2) {
          throw new Error(
            `[BackendFacade] Invalid command type "${command.type}". Expected "service.operation".`
          );
        }
        const [serviceName, operationName] = parts;
        const service = this.services.get(serviceName);
        if (!service) {
          throw new Error(`[BackendFacade] Service "${serviceName}" not registered.`);
        }

        const data = (await service.execute(operationName, command.payload)) as T;
        return {
          correlationId: command.correlationId,
          status: 'COMPLETED',
          data,
          executionTimestamp: Date.now(),
        };
      } catch (err: any) {
        return {
          correlationId: command.correlationId,
          status: 'FAILED',
          error: err?.message || String(err),
          executionTimestamp: Date.now(),
        };
      }
    };

    if (command.idempotencyKey) {
      return await this.idempotency.executeIdempotent(command.idempotencyKey, runCore);
    }

    return await runCore();
  }
}
