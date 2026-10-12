/**
 * @file types.ts
 * @description Formal TypeScript types for SKIPO_EXECUTION system.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

export type JobPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type JobStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRYING';

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  jitter?: boolean;
}

export interface SkipoCommand<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
  correlationId: string;
  lifecycle?: string;
  createdAt: number;
}

export interface ExecutionJob<TPayload = unknown> {
  id: string;
  command: SkipoCommand<TPayload>;
  idempotencyKey: string;
  correlationId: string;
  retryPolicy?: RetryPolicy;
  priority?: JobPriority;
  dependencies?: string[];
  status: JobStatus;
  progress?: number;
  attempts?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionResult<TResult = unknown> {
  correlationId: string;
  status: 'COMPLETED' | 'FAILED';
  data?: TResult;
  error?: string;
  executionTimeMs?: number;
}

export interface ExecutionQueueAdapter {
  enqueue<T = unknown>(job: ExecutionJob<T>): Promise<string>;
  getJobStatus(jobId: string): Promise<JobStatus | undefined>;
  getJobResult<R = unknown>(jobId: string): Promise<ExecutionResult<R> | undefined>;
  cancel(jobId: string): Promise<boolean>;
  close(): Promise<void>;
}
