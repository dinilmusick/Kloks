/**
 * @file hooks.ts
 * @description React integration hooks for SKIPO_EXECUTION.
 * Routes all frontend mutations through BullMQ commands and reflects updates into SKIPO_STATE.
 */

import { useState, useCallback } from 'react';
import { SKIPO_EXECUTION } from './SkipoExecution.js';
import { useSkipoState } from '../state/hooks.js';
import { EnqueueOptions } from './CommandBus.js';
import { ExecutionJob } from './types.js';

export interface CommandExecutionState<TResult = unknown> {
  status: 'IDLE' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  correlationId?: string;
  data?: TResult;
  error?: string;
  completedAt?: number;
}

export function useCommand<TPayload = unknown, TResult = unknown>(
  type: string,
  defaultOptions: EnqueueOptions = {}
) {
  const [activeCorrId, setActiveCorrId] = useState<string | null>(null);

  const [execState] = useSkipoState<CommandExecutionState<TResult>>(
    activeCorrId ? `execution_${activeCorrId}` : `execution_idle_${type}`,
    { status: 'IDLE' }
  );

  const dispatch = useCallback(
    async (payload: TPayload, options?: Partial<EnqueueOptions>): Promise<ExecutionJob<TPayload>> => {
      const mergedOptions = { ...defaultOptions, ...options };
      const job = await SKIPO_EXECUTION.dispatch<TPayload>(type, payload, mergedOptions);
      setActiveCorrId(job.correlationId);
      return job;
    },
    [type, defaultOptions]
  );

  return {
    dispatch,
    status: execState.status,
    isPending: execState.status === 'QUEUED' || execState.status === 'RUNNING',
    result: execState.data,
    error: execState.error,
    correlationId: execState.correlationId,
  };
}
