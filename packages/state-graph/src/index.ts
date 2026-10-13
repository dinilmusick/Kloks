/**
 * @file index.ts
 * @description @kloks/state-graph — Non-UI State, Execution, and Node-Graph Domain/Rules/Spatial Services built on KrnlTS.
 */

import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';

export * from './state/index.js';
export * from './execution/index.js';
export * from './domain/index.js';
export * from './rules/index.js';
export * from './spatial/index.js';
export * from './store/index.js';
export * from './Viewport.js';
export * from './BoxSelection.js';
export * from './types.js';
export * from './engine/index.js';
export {
  type GraphDefinition,
  type GroupNode,
  type Landmark,
  type PhysicalInputDefinition,
  type PhysicalOutputDefinition,
  type SubgraphNode,
  convertPhysicalInputToStreamHandle,
  convertPhysicalOutputToStreamHandle,
} from './engine/index.js';
export {
  GroupNode as DomainGroupNode,
  SubgraphNode as DomainSubgraphNode,
  instantiateSubgraph,
} from './domain/index.js';

import { ConnectionRuleStore } from './rules/ConnectionRuleStore.js';
import { LifecycleGraph } from './state/LifecycleGraph.js';
import { computePredictiveGraph } from './engine/predictive/predictiveGraphEngine.js';
import { materializePredictiveGhostBatch } from './engine/predictive/solidifyExecution.js';
import type { SpaceNode, NodeConnection } from './engine/types/legacyTypes.js';
import type { PredictiveGhostNode } from './engine/predictive/types.js';

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

// 3. PredictiveGraphService (KrnlTS Service for Node Graph Auto-Complete Suggestions)
export const PredictiveGraphServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.graph.predictive',
  name: 'PredictiveGraphService',
  version: '1.0.0',
  operations: {
    computeSuggestions: {
      id: 'PredictiveGraphService.computeSuggestions',
      name: 'computeSuggestions',
      handler: async (input: { selectedNodes: SpaceNode[]; connections: NodeConnection[]; scenarioIndex?: number }) => {
        return computePredictiveGraph(input.selectedNodes, input.connections, input.scenarioIndex ?? 0);
      },
    },
    solidifyBatch: {
      id: 'PredictiveGraphService.solidifyBatch',
      name: 'solidifyBatch',
      handler: async (input: { ghosts: PredictiveGhostNode[]; existingNodes: SpaceNode[]; bpm: number; existingConnections: NodeConnection[] }) => {
        return materializePredictiveGhostBatch(input.ghosts, input.existingNodes, input.bpm, input.existingConnections);
      },
    },
  },
});

const predictiveGraphServiceInstance: IService = createService(PredictiveGraphServiceDefinition);

export const PredictiveGraphServiceFacade = {
  id: PredictiveGraphServiceDefinition.id,
  name: PredictiveGraphServiceDefinition.name,
  version: PredictiveGraphServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: PredictiveGraphServiceDefinition,
  createInstance: () => createService(PredictiveGraphServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await predictiveGraphServiceInstance.start(); return predictiveGraphServiceInstance.call<TIn, TOut>(op, input); },
};
