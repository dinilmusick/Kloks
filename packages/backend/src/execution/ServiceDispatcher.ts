/**
 * @file ServiceDispatcher.ts
 * @description Domain-level orchestration unit coordinating OperationComponents.
 * Conforms to SKIPO::STATE_EXECUTION_ARCHITECTURE and L9 (<=200L).
 */

import { DomainService, OperationComponent } from './types.js';

export class ServiceDispatcher implements DomainService {
  public operations: Record<string, OperationComponent<any, any>> = {};

  constructor(public readonly name: string) {}

  registerOperation<TIn = unknown, TOut = unknown>(
    opName: string,
    operation: OperationComponent<TIn, TOut>
  ): this {
    this.operations[opName] = operation;
    return this;
  }

  async execute(operationName: string, input: unknown): Promise<unknown> {
    const op = this.operations[operationName];
    if (!op) {
      throw new Error(
        `[ServiceDispatcher:${this.name}] Operation "${operationName}" not found.`
      );
    }
    return await op.execute(input);
  }
}
