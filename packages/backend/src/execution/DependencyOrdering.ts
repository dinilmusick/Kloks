/**
 * @file DependencyOrdering.ts
 * @description Dependency graph ordering and race-condition prevention for jobs.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

import { JobScheduler } from '../connectivity/JobScheduler.js';
import { Job } from '../connectivity/types.js';

export class JobDependencyGraph {
  private scheduler: JobScheduler;

  constructor(maxConcurrency = 5) {
    this.scheduler = new JobScheduler(maxConcurrency);
  }

  registerHandler<TPayload = any, TResult = any>(
    type: string,
    handler: (job: Job<TPayload, TResult>) => Promise<TResult>
  ): this {
    this.scheduler.registerHandler(type, (job) => handler(job));
    return this;
  }

  submitJob<TPayload = any, TResult = any>(
    type: string,
    payload: TPayload,
    dependencies: string[] = [],
    idempotencyKey?: string
  ): Job<TPayload, TResult> {
    return this.scheduler.submit<TPayload, TResult>({
      type,
      payload,
      dependencies,
      correlationId: idempotencyKey,
    });
  }

  getJob(jobId: string): Job | undefined {
    return this.scheduler.status(jobId);
  }

  clear(): void {
    this.scheduler.clear();
  }
}
