/**
 * @file CommandBus.ts
 * @description Frontend Command factory & enqueue transport boundary.
 * Enforces Invariants I7-I10: all backend-bound operations MUST go through commands.
 */

import { ExecutionJob, JobPriority, RetryPolicy, SkipoCommand } from './types.js';
import { BullMQAdapter } from './BullMQAdapter.js';

export interface EnqueueOptions {
  idempotencyKey?: string;
  correlationId?: string;
  priority?: JobPriority;
  retryPolicy?: RetryPolicy;
  dependencies?: string[];
}

export class CommandBus {
  constructor(private adapter: BullMQAdapter) {}

  createCommand<TPayload = unknown>(
    type: string,
    payload: TPayload,
    metadata?: Record<string, unknown>,
    lifecycle?: string
  ): SkipoCommand<TPayload> {
    const timestamp = Date.now();
    const id = `cmd_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
    const correlationId = `corr_${timestamp}_${Math.random().toString(36).slice(2, 9)}`;

    return {
      id,
      type,
      payload,
      metadata,
      correlationId,
      lifecycle,
      createdAt: timestamp,
    };
  }

  async enqueue<TPayload = unknown>(
    command: SkipoCommand<TPayload>,
    options: EnqueueOptions = {}
  ): Promise<ExecutionJob<TPayload>> {
    const now = Date.now();
    const idempotencyKey =
      options.idempotencyKey || `idem_${command.type}_${command.correlationId}`;

    const job: ExecutionJob<TPayload> = {
      id: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
      command,
      idempotencyKey,
      correlationId: options.correlationId || command.correlationId,
      retryPolicy: options.retryPolicy || { maxAttempts: 3, backoffMs: 1000 },
      priority: options.priority || 'NORMAL',
      dependencies: options.dependencies || [],
      status: 'QUEUED',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.adapter.enqueue(job);
    return job;
  }
}
