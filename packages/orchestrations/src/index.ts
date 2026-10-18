/**
 * @file index.ts
 * @description @kloks/orchestrations — Canonical Orchestrators A & B built on KrnlTS & @kloks/services.
 * Orchestrator A: Service A (Pure) -> Service B (Stateful)
 * Orchestrator B: Service B (Stateful) -> Service C (Event-Emitting)
 */

import {
  ServiceAFacade,
  ServiceBFacade,
  ServiceCFacade,
  type CounterState,
  type TelemetryEvents,
} from '@kloks/services';

export interface OrchestratorFacade<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dependencies: string[];
  execute(input: TInput): Promise<TOutput>;
}

export interface OrchestratorAInput {
  a: number;
  b: number;
  operation?: 'add' | 'multiply';
}

export interface OrchestratorAOutput {
  computed: number;
  state: CounterState;
}

/**
 * Orchestrator A: Sequences Service A (Pure Math) -> Service B (Stateful Counter)
 */
export const OrchestratorAFacade: OrchestratorFacade<OrchestratorAInput, OrchestratorAOutput> = {
  id: 'kloks.orchestrator.a',
  name: 'OrchestratorA',
  version: '1.0.0',
  dependencies: [ServiceAFacade.id, ServiceBFacade.id],
  execute: async (input: OrchestratorAInput): Promise<OrchestratorAOutput> => {
    const op = input.operation ?? 'add';
    const mathOut = await ServiceAFacade.execute<{ a: number; b: number }, { result: number }>(op, {
      a: input.a,
      b: input.b,
    });
    const stateOut = await ServiceBFacade.execute<{ delta: number }, CounterState>('increment', {
      delta: mathOut.result,
    });
    return {
      computed: mathOut.result,
      state: stateOut,
    };
  },
};

export interface OrchestratorBInput {
  delta?: number;
  metricName?: string;
}

export interface OrchestratorBOutput {
  state: CounterState;
  emitted: TelemetryEvents['reading'];
}

/**
 * Orchestrator B: Sequences Service B (Stateful Counter) -> Service C (Event-Emitting Telemetry)
 */
export const OrchestratorBFacade: OrchestratorFacade<OrchestratorBInput, OrchestratorBOutput> = {
  id: 'kloks.orchestrator.b',
  name: 'OrchestratorB',
  version: '1.0.0',
  dependencies: [ServiceBFacade.id, ServiceCFacade.id],
  execute: async (input: OrchestratorBInput = {}): Promise<OrchestratorBOutput> => {
    const state = await ServiceBFacade.execute<{ delta: number }, CounterState>('increment', {
      delta: input.delta ?? 1,
    });
    const emitted = await ServiceCFacade.execute<
      { metric: string; value: number },
      TelemetryEvents['reading']
    >('publishReading', {
      metric: input.metricName ?? 'counter.value',
      value: state.count,
    });
    return {
      state,
      emitted,
    };
  },
};

