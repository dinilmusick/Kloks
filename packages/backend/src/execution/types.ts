/**
 * @file types.ts
 * @description Formal TypeScript types for backend execution boundary.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

export interface ExecutionContext {
  isWorkerContext: boolean;
  workerId?: string;
  timestamp: number;
}

export interface BackendCommand<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
  correlationId: string;
  idempotencyKey?: string;
  createdAt: number;
}

export interface NormalizedResult<TData = unknown> {
  correlationId: string;
  status: 'COMPLETED' | 'FAILED';
  data?: TData;
  error?: string;
  executionTimestamp: number;
}

export interface OperationComponent<TInput = unknown, TOutput = unknown> {
  name: string;
  execute(input: TInput): Promise<TOutput>;
}

export interface DomainService {
  name: string;
  operations: Record<string, OperationComponent<any, any>>;
  execute(operationName: string, input: unknown): Promise<unknown>;
}
