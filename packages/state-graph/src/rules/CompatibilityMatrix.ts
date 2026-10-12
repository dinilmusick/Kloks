import type { BaseHandle, HandleCategory } from '../domain/BaseHandle.js';

export interface CompatibilityRule {
  sourceCategory: HandleCategory;
  sourceDataType: string;
  targetCategory: HandleCategory;
  targetDataType: string;
  allowed: boolean;
  wireType: string;
  priority: number;
}

export interface CompatibilityResolution {
  allowed: boolean;
  wireType?: string;
  priority?: number;
  reason?: string;
}

export class CompatibilityMatrix {
  private static rules: CompatibilityRule[] = [];

  public static registerRule(rule: CompatibilityRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  public static clear(): void {
    this.rules = [];
  }

  public static resolve(
    sourceHandle: Pick<BaseHandle, 'handleCategory' | 'dataType' | 'direction'>,
    targetHandle: Pick<BaseHandle, 'handleCategory' | 'dataType' | 'direction'>
  ): CompatibilityResolution {
    if (sourceHandle.direction === targetHandle.direction) {
      return { allowed: false, reason: 'Cannot connect handles of the same direction' };
    }

    const isViewConnection = sourceHandle.handleCategory === 'VIEW' || targetHandle.handleCategory === 'VIEW';
    if (isViewConnection) {
      return { allowed: false, reason: 'View handles do not connect via data compatibility matrix' };
    }

    const sType = sourceHandle.dataType.toUpperCase();
    const tType = targetHandle.dataType.toUpperCase();

    for (const rule of this.rules) {
      const matchSource = rule.sourceDataType === '*' || rule.sourceDataType.toUpperCase() === sType;
      const matchTarget = rule.targetDataType === '*' || rule.targetDataType.toUpperCase() === tType;
      const matchCategory = rule.sourceCategory === sourceHandle.handleCategory && rule.targetCategory === targetHandle.handleCategory;

      if (matchCategory && matchSource && matchTarget) {
        return {
          allowed: rule.allowed,
          wireType: rule.wireType,
          priority: rule.priority,
          reason: rule.allowed ? 'Compatible' : 'Explicitly rejected by rule'
        };
      }
    }

    if (sType === tType && sType !== 'UNKNOWN') {
      return {
        allowed: true,
        wireType: sType,
        priority: 0,
        reason: 'Implicit matching data type'
      };
    }

    return { allowed: false, reason: `Incompatible types: ${sType} -> ${tType}` };
  }
}
