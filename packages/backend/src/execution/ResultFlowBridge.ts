/**
 * @file ResultFlowBridge.ts
 * @description Bridges execution results back to frontend state update streams.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

import { NormalizedResult } from './types.js';

export interface StateUpdateEvent<T = unknown> {
  type: 'SKIPO_STATE_UPDATE';
  correlationId: string;
  status: 'COMPLETED' | 'FAILED';
  data?: T;
  error?: string;
  timestamp: number;
}

export class ResultFlowBridge {
  static formatStateUpdate<T = unknown>(result: NormalizedResult<T>): StateUpdateEvent<T> {
    return {
      type: 'SKIPO_STATE_UPDATE',
      correlationId: result.correlationId,
      status: result.status,
      data: result.data,
      error: result.error,
      timestamp: result.executionTimestamp,
    };
  }
}
