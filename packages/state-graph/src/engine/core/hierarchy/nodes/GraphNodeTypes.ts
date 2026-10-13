// ══════════════════════════════════════════════════════════════════════════════════════════
// 1. IMPORTS & EXTERNAL DEPENDENCIES
// ══════════════════════════════════════════════════════════════════════════════════════════
import { GraphNodeParent } from './GraphNodeParent';
import {
  SpaceNode,
  TriggerNode,
  ContainerNode,
  CombinerNode,
  MultiplexerNode,
  EffectNode,
  ModuleNode,
  ConverterNode,
} from "../../../types/index.js";

// ── 1. Trigger Node Family ──
export class QwnsrTriggerNodeModel extends GraphNodeParent<TriggerNode> {
  constructor(node: TriggerNode) {
    super(node);
  }

  public trigger(timestamp?: number): void {
    this.emit('pulse_triggered', { timestamp: timestamp || Date.now() });
  }
}

// ── 2. Container Node Family (Sampler, Instrument, Audio, Curve, MIDI) ──
export class QwnsrContainerNodeModel extends GraphNodeParent<ContainerNode> {
  constructor(node: ContainerNode) {
    super(node);
  }

  public getContainerType(): string {
    return this.rawNode.containerType || 'midi';
  }

  public trigger(timestamp?: number): void {
    this.emit('container_playback_triggered', {
      type: this.getContainerType(),
      timestamp: timestamp || Date.now(),
    });
  }
}

// ── 3. Audio In & Out Family ──
// ── 3. Combiner & Multiplexer Routing Family ──
export class QwnsrCombinerNodeModel extends GraphNodeParent<CombinerNode> {
  constructor(node: CombinerNode) {
    super(node);
  }

  public trigger(): void {
    this.emit('combiner_sum_evaluated');
  }
}

export class QwnsrMultiplexerNodeModel extends GraphNodeParent<MultiplexerNode> {
  constructor(node: MultiplexerNode) {
    super(node);
  }

  public trigger(): void {
    this.emit('multiplexer_routed');
  }
}

// ── 6. Effect Node Family (AoE Field) ──
export class QwnsrEffectNodeModel extends GraphNodeParent<EffectNode> {
  constructor(node: EffectNode) {
    super(node);
  }

  public trigger(): void {
    this.emit('effect_field_pulsed', { radius: this.rawNode.radius });
  }
}

// ── 7. Module Node Family (Sub-Graph Nesting) ──
export class QwnsrModuleNodeModel extends GraphNodeParent<ModuleNode> {
  constructor(node: ModuleNode) {
    super(node);
  }

  public trigger(): void {
    this.emit('module_subgraph_evaluated');
  }
}

// ── 8. Converter & Generic Node Family ──
export class QwnsrGenericNodeModel extends GraphNodeParent<SpaceNode> {
  constructor(node: SpaceNode) {
    super(node);
  }

  public trigger(): void {
    this.emit('generic_node_triggered');
  }
}

/**
 * Polymorphic Factory: Returns the strongly typed QwnsrNode instance.
 */
export function createQwnsrNodeInstance(node: SpaceNode): GraphNodeParent {
  switch (node.type) {
    case 'trigger':
      return new QwnsrTriggerNodeModel(node as TriggerNode);
    case 'container':
      return new QwnsrContainerNodeModel(node as ContainerNode);
    case 'combiner':
      return new QwnsrCombinerNodeModel(node as CombinerNode);
    case 'multiplexer':
      return new QwnsrMultiplexerNodeModel(node as MultiplexerNode);
    case 'effect':
      return new QwnsrEffectNodeModel(node as EffectNode);
    case 'module':
      return new QwnsrModuleNodeModel(node as ModuleNode);
    default:
      return new QwnsrGenericNodeModel(node);
  }
}
