/**
 * @file SkipoExecution.ts
 * @description Canonical SKIPO_EXECUTION system orchestrator.
 * Connects BullMQ queues, CommandBus, and SKIPO_STATE result flow.
 */

import { BullMQAdapter } from './BullMQAdapter.js';
import { CommandBus, EnqueueOptions } from './CommandBus.js';
import { ExecutionJob, ExecutionResult, SkipoCommand } from './types.js';
import { SKIPO_STATE } from '../state/SkipoState.js';

export class SkipoExecutionEngine {
  public readonly frontendQueue: BullMQAdapter;
  public readonly backendQueue: BullMQAdapter;
  public readonly commandBus: CommandBus;

  constructor(options: { redisConnection?: { host?: string; port?: number; url?: string } } = {}) {
    this.frontendQueue = new BullMQAdapter({
      queueName: 'FRONTEND_EXECUTION_QUEUE',
      connection: options.redisConnection,
    });
    this.backendQueue = new BullMQAdapter({
      queueName: 'BACKEND_EXECUTION_QUEUE',
      connection: options.redisConnection,
    });
    this.commandBus = new CommandBus(this.frontendQueue);
  }

  createCommand<TPayload = unknown>(
    type: string,
    payload: TPayload,
    metadata?: Record<string, unknown>,
    lifecycle?: string
  ): SkipoCommand<TPayload> {
    return this.commandBus.createCommand(type, payload, metadata, lifecycle);
  }

  async dispatch<TPayload = unknown>(
    type: string,
    payload: TPayload,
    options: EnqueueOptions = {}
  ): Promise<ExecutionJob<TPayload>> {
    const cmd = this.createCommand(type, payload, undefined, options.correlationId);
    const job = await this.commandBus.enqueue(cmd, options);

    // Initial state registration in SKIPO_STATE
    const stateId = `execution_${job.correlationId}`;
    SKIPO_STATE.create(
      'SKIPO_EXECUTION',
      { type: 'APP' },
      { status: 'QUEUED', correlationId: job.correlationId, progress: 0 },
      stateId
    );

    return job;
  }

  propagateResult<TResult = unknown>(
    correlationId: string,
    result: ExecutionResult<TResult>
  ): void {
    const stateId = `execution_${correlationId}`;
    if (SKIPO_STATE.get(stateId)) {
      SKIPO_STATE.update(stateId, () => ({
        status: result.status,
        correlationId,
        data: result.data,
        error: result.error,
        completedAt: Date.now(),
      }));
    }
  }

  async close(): Promise<void> {
    await this.frontendQueue.close();
    await this.backendQueue.close();
  }
}

export const SKIPO_EXECUTION = new SkipoExecutionEngine();
