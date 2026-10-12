/**
 * @file OperationComponent.ts
 * @description Smallest deterministic executable domain operation.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

import { OperationComponent } from './types.js';

export function createOperationComponent<TInput = unknown, TOutput = unknown>(
  name: string,
  handler: (input: TInput) => Promise<TOutput> | TOutput
): OperationComponent<TInput, TOutput> {
  return {
    name,
    async execute(input: TInput): Promise<TOutput> {
      try {
        return await handler(input);
      } catch (err: any) {
        throw new Error(
          `[OperationComponent:${name}] Execution failure: ${err?.message || String(err)}`
        );
      }
    },
  };
}
