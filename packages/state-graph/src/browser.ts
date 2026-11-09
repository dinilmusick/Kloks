/**
 * Browser-safe state-graph surface.
 *
 * This entrypoint intentionally excludes the KrnlTS-backed service definitions
 * exported by src/index.ts. Browser consumers must use this surface.
 */
export * from './types.js';
export * from './Viewport.js';
export * from './BoxSelection.js';
export * from './domain/index.js';
export * from './rules/index.js';
export * from './spatial/index.js';
export * from './engine/types/legacyTypes.js';
export * from './engine/core/types.js';
export * from './engine/core/hierarchy/core/GraphEntityParent.js';
export * from './engine/core/hierarchy/sockets/GraphSocketParent.js';
export * from './engine/core/hierarchy/sockets/GraphSocketTypes.js';
export * from './engine/core/hierarchy/wires/GraphWireParent.js';
export * from './engine/core/hierarchy/wires/GraphWireTypes.js';
export * from './engine/core/hierarchy/nodes/GraphNodeParent.js';
export * from './engine/core/hierarchy/nodes/GraphNodeTypes.js';
export * from './engine/core/hierarchy/nodes/nodeGeometry.js';
export * from './engine/core/hierarchy/magnetic/magneticGraphBridge.js';
export * from './engine/core/hierarchy/magnetic/magneticGraphManager.js';
export * from './engine/core/hierarchy/ui/UIElementBase.js';
export * from './engine/core/hierarchy/magnetic/magneticGraphBridge.js';
export * from './engine/core/nodeAssetRegistry.js';
export * from './engine/core/nodeSocketRegistry.js';
export * from './engine/GraphConcepts.js';
export * from './engine/AudioConcepts.js';
export * from './engine/BufferConcepts.js';
export * from './engine/UIConcepts.js';
export * from './engine/functions/canonicalSignalTable.js';
export * from './engine/functions/rotaryGeometry.js';
export * from './engine/predictive/index.js';

export function getBeamPoints(offset: {x: number; y: number}, width: number, height: number): string {
  const x = offset.x;
  const y = offset.y;
  return [
    x + ',' + y,
    (x + width) + ',' + (y - height),
    (x + width + 2) + ',' + y,
    (x + width) + ',' + (y + height),
  ].join(' ');
}
