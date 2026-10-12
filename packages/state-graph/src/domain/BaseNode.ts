import type { BaseHandle, HandleDefinition } from './BaseHandle.js';

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface NodeDefinition {
  type: string;
  label: string;
  description?: string;
  inputs?: HandleDefinition[];
  outputs?: HandleDefinition[];
  views?: string[];
  metadata?: Record<string, unknown>;
}

export interface BaseNodeProps {
  id: string;
  type: string;
  label?: string;
  position: NodePosition;
  size?: NodeSize;
  handles?: BaseHandle[];
  state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  positionLocked?: boolean;
  minimized?: boolean;
}

export abstract class BaseNode {
  public id: string;
  public type: string;
  public label: string;
  public position: NodePosition;
  public size: NodeSize;
  public handles: BaseHandle[];
  public state: Record<string, unknown>;
  public metadata: Record<string, unknown>;
  public settings: Record<string, unknown>;
  public positionLocked: boolean;
  public minimized: boolean;

  constructor(props: BaseNodeProps) {
    this.id = props.id;
    this.type = props.type;
    this.label = props.label ?? props.type;
    this.position = { ...props.position };
    this.size = props.size ?? { width: 180, height: 120 };
    this.handles = props.handles ? [...props.handles] : [];
    this.state = props.state ? { ...props.state } : {};
    this.metadata = props.metadata ? { ...props.metadata } : {};
    this.settings = props.settings ? { ...props.settings } : {};
    this.positionLocked = props.positionLocked ?? false;
    this.minimized = props.minimized ?? false;
  }

  public getHandle(handleId: string): BaseHandle | undefined {
    return this.handles.find(h => h.id === handleId);
  }

  public addHandle(handle: BaseHandle): void {
    const existingIndex = this.handles.findIndex(h => h.id === handle.id);
    if (existingIndex >= 0) {
      this.handles[existingIndex] = handle;
    } else {
      this.handles.push(handle);
    }
  }

  public lockPosition(): void {
    this.positionLocked = true;
  }

  public unlockPosition(): void {
    this.positionLocked = false;
  }
}

export class CustomNode extends BaseNode {
  public customDefinition?: NodeDefinition;
}
