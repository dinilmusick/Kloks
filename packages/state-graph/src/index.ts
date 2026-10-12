/**
 * @file index.ts
 * @description @kloks/state-graph — Non-UI State, Execution, and Node-Graph Domain/Rules/Spatial Services built on KrnlTS.
 */

import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@dinilmusick/krnl';

export * from './state/index.js';
export * from './execution/index.js';
export * from './domain/index.js';
export * from './rules/index.js';
export * from './spatial/index.js';
export * from './store/index.js';
export * from './Viewport.js';
export * from './BoxSelection.js';
export * from './types.js';

import { ConnectionRuleStore } from './rules/ConnectionRuleStore.js';
import { LifecycleGraph } from './state/LifecycleGraph.js';

// 1. StateLifecycleService (KrnlTS Service)
export const StateLifecycleServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.state.lifecycle',
  name: 'StateLifecycleService',
  version: '1.0.0',
  operations: {
    validateTransition: {
      id: 'StateLifecycleService.validateTransition',
      name: 'validateTransition',
      handler: async (input: { from: string; to: string }) => {
        const graph = new LifecycleGraph();
        return {
          from: input.from,
          to: input.to,
          graphReady: Boolean(graph),
        };
      },
    },
  },
});

const stateLifecycleServiceInstance: IService = createService(StateLifecycleServiceDefinition);

export const StateLifecycleServiceFacade = {
  id: StateLifecycleServiceDefinition.id,
  name: StateLifecycleServiceDefinition.name,
  version: StateLifecycleServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: StateLifecycleServiceDefinition,
  createInstance: () => createService(StateLifecycleServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await stateLifecycleServiceInstance.start(); return stateLifecycleServiceInstance.call<TIn, TOut>(op, input); },
};

// 2. NodeGraphEngineService (KrnlTS Service)
export const NodeGraphEngineServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.graph.engine',
  name: 'NodeGraphEngineService',
  version: '1.0.0',
  operations: {
    getRuleStoreStatus: {
      id: 'NodeGraphEngineService.getRuleStoreStatus',
      name: 'getRuleStoreStatus',
      handler: async () => {
        const store = new ConnectionRuleStore();
        return {
          initialized: Boolean(store),
          timestamp: Date.now(),
        };
      },
    },
  },
});

const nodeGraphEngineInstance: IService = createService(NodeGraphEngineServiceDefinition);

export const NodeGraphEngineServiceFacade = {
  id: NodeGraphEngineServiceDefinition.id,
  name: NodeGraphEngineServiceDefinition.name,
  version: NodeGraphEngineServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: NodeGraphEngineServiceDefinition,
  createInstance: () => createService(NodeGraphEngineServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await nodeGraphEngineInstance.start(); return nodeGraphEngineInstance.call<TIn, TOut>(op, input); },
};
